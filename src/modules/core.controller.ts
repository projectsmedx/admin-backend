import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "../config.js";
import { DbService } from "../database/db.service.js";
import { CurrentSession, Public } from "../auth/auth.guard.js";
import { AccessService, HttpError, type Session } from "../domain/access.service.js";
import { Repo } from "../domain/repository.service.js";
import { ACTIONS, type Action, type Resource } from "../domain/rbac.js";
import { DashboardService } from "./dashboard.service.js";
import { StorageService } from "../storage/storage.service.js";
import { sendCsv } from "./support.js";

@Controller()
export class CoreController {
  constructor(private readonly db: DbService, private readonly repo: Repo, private readonly access: AccessService, private readonly dashboard: DashboardService, private readonly storage: StorageService) {}

  @Public()
  @Get("health")
  async health() {
    // Public endpoint: report connection health only, not the host or user
    const s = await this.db.status();
    return { status: "ok", database: "connected", time: s.now, latencyMs: s.latencyMs, version: s.version, pool: s.pool };
  }

  @Get("dashboard")
  dash(@CurrentSession() s: Session) {
    this.access.assertCan(s, "dashboard", "view");
    return this.dashboard.build(s);
  }

  /** Non-sensitive company directory used for pickers, names and the org chart. */
  @Get("directory")
  async directory() {
    return this.db.query(
      `SELECT id, code, first_name || ' ' || last_name AS name, work_email AS email, phone, designation_id AS "designationId", department_id AS "departmentId",
              manager_id AS "managerId", location_id AS "locationId", job_role AS "jobRole", initcap(replace(status::text,'_',' ')) AS status, avatar_color AS "avatarColor",
              joining_date AS "joiningDate", CASE employment_type WHEN 'full_time' THEN 'Full-time' WHEN 'part_time' THEN 'Part-time' ELSE initcap(employment_type::text) END AS "employmentType",
              initcap(work_mode::text) AS "workMode", initcap(gender::text) AS gender, initcap(engagement_type) AS "engagementType",
              (SELECT role FROM users WHERE employee_id = employees.id) AS role
       FROM employees WHERE deleted_at IS NULL ORDER BY first_name, last_name`,
    );
  }

  @Get("org-chart")
  async orgChart(@Query("departmentId") departmentId?: string) {
    const rows = await this.directory() as { id: string; managerId: string | null; departmentId: string }[];
    const list = departmentId ? rows.filter((r) => r.departmentId === departmentId) : rows;
    const ids = new Set(list.map((r) => r.id));
    type Node = (typeof list)[number] & { children: Node[] };
    const map = new Map<string, Node>(list.map((r) => [r.id, { ...r, children: [] }]));
    const roots: Node[] = [];
    for (const n of map.values()) (n.managerId && ids.has(n.managerId) ? map.get(n.managerId)!.children : roots).push(n);
    return roots;
  }

  // ----------------------------------------------------------------------- settings & company
  @Get("settings")
  settings() {
    return this.access.settings();
  }

  @Put("settings/:section")
  async putSettings(@CurrentSession() s: Session, @Param("section") section: string, @Body() body: Record<string, unknown>) {
    this.access.assertCan(s, "settings", "edit");
    const data = (body?.data as Record<string, unknown>) ?? body;
    const before = (await this.access.settings())[section] ?? {};
    await this.db.tx(async () => {
      for (const [key, value] of Object.entries(data)) {
        await this.db.query(
          `INSERT INTO settings (section, key, value, updated_by) VALUES ($1,$2,$3,$4) ON CONFLICT (section, key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
          [section, key, JSON.stringify(value), s.userId],
        );
      }
      if (section === "company") {
        const c = { ...before, ...data } as Record<string, string>;
        await this.db.query(
          "UPDATE company SET name=$1, legal_name=$2, trade_license=$3, trn=$4, mol_establishment_id=$5, email=$6, phone=$7, website=$8, address=$9, currency=coalesce($10,'AED'), timezone=coalesce($11,'Asia/Dubai'), updated_at=now()",
          [c.name, c.legalName, c.tradeLicense, c.trn, c.molEstablishmentId, c.email, c.phone, c.website, c.address, c.currency, c.timezone],
        );
      }
      await this.access.audit(s, "Settings Updated", "settings", section, { changes: this.access.diff(before, data) });
    });
    return this.access.settings();
  }

  @Get("company")
  async company() {
    return (await this.access.settings()).company ?? {};
  }

  @Put("company")
  putCompany(@CurrentSession() s: Session, @Body() body: Record<string, unknown>) {
    return this.putSettings(s, "company", body);
  }

  @Put("integrations/:provider")
  async putIntegration(@CurrentSession() s: Session, @Param("provider") provider: string, @Body() b: { enabled?: boolean; config?: Record<string, unknown> }) {
    this.access.assertCan(s, "settings", "edit");
    const row = await this.db.one(
      `INSERT INTO integrations (provider, is_enabled, config) VALUES ($1, $2, $3)
       ON CONFLICT (provider) DO UPDATE SET is_enabled = EXCLUDED.is_enabled, config = EXCLUDED.config, updated_at = now()
       RETURNING id, provider, is_enabled AS enabled, config`,
      [provider, !!b?.enabled, JSON.stringify(b?.config ?? {})],
    );
    await this.access.audit(s, "Integration Updated", "integrations", provider, { enabled: !!b?.enabled });
    return row;
  }

  // ----------------------------------------------------------------------- roles
  @Get("roles")
  async roles(@CurrentSession() s: Session) {
    this.access.assertCan(s, "users", "view");
    const roles = await this.db.query<{ id: string; key: string; name: string; description: string; is_system: boolean }>("SELECT * FROM roles ORDER BY name");
    return roles.map((r) => ({ id: r.id, key: r.key, name: r.name, description: r.description, isSystem: r.is_system, permissions: this.access.permissions(r.key as Session["role"]) }));
  }

  @Put("roles/:id/permissions")
  async setPermissions(@CurrentSession() s: Session, @Param("id") id: string, @Body() body: { resource: Resource; actions: Action[]; scope: string }[]) {
    this.access.assertCan(s, "users", "manage");
    if (!Array.isArray(body)) throw new HttpError(400, "Body must be an array of { resource, actions[], scope }");
    const role = await this.db.one<{ key: string }>("SELECT key FROM roles WHERE id=$1", [id]);
    if (!role) throw new HttpError(404, "Role not found");
    if (role.key === "super_admin") throw new HttpError(409, "Super Admin permissions can't be changed");
    await this.db.tx(async () => {
      await this.db.query("DELETE FROM role_permissions WHERE role_id=$1", [id]);
      for (const p of body) {
        const actions = (p.actions ?? []).filter((a) => (ACTIONS as readonly string[]).includes(a));
        if (!["own", "team", "department", "all"].includes(p.scope)) throw new HttpError(400, `Invalid scope for ${p.resource}`);
        await this.db.query("INSERT INTO role_permissions (role_id, resource, actions, scope) VALUES ($1,$2,$3,$4)", [id, p.resource, actions, p.scope]);
      }
      await this.access.audit(s, "Permissions Changed", "roles", id, { role: role.key, permissions: body });
    });
    await this.access.loadPermissions();
    return { ok: true };
  }

  // ----------------------------------------------------------------------- notifications
  private async mine(s: Session) {
    const groups = Object.entries({ all: true, hr: s.role === "super_admin", finance: s.role === "super_admin" }).filter(([, v]) => v).map(([k]) => k);
    return this.db.query<Record<string, any>>(
      `SELECT n.id, n.title, n.message, n.link, n.created_at AS "createdAt", n.role_group AS role,
              CASE WHEN n.role_group IS NULL THEN n.is_read ELSE (r.user_id IS NOT NULL) END AS read
       FROM notifications n LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = $1
       WHERE n.user_id = $1 OR n.role_group = ANY($2) ORDER BY n.created_at DESC LIMIT 50`,
      [s.userId, groups],
    );
  }

  @Get("notifications")
  notifications(@CurrentSession() s: Session) {
    return this.mine(s);
  }

  @Post("notifications/read-all")
  @HttpCode(200)
  async readAll(@CurrentSession() s: Session) {
    for (const n of await this.mine(s)) await this.markRead(s, n.id);
    return { ok: true };
  }

  @Post("notifications/:id/read")
  @HttpCode(200)
  async readOne(@CurrentSession() s: Session, @Param("id") id: string) {
    await this.markRead(s, id);
    return { ok: true };
  }

  private async markRead(s: Session, id: string) {
    await this.db.query("UPDATE notifications SET is_read = true WHERE id=$1 AND user_id=$2", [id, s.userId]);
    await this.db.query("INSERT INTO notification_reads (notification_id, user_id) SELECT id, $2 FROM notifications WHERE id=$1 AND role_group IS NOT NULL ON CONFLICT DO NOTHING", [id, s.userId]);
  }

  // ----------------------------------------------------------------------- audit export
  @Get("audit-logs/export")
  async auditExport(@CurrentSession() s: Session, @Res() res: Response, @Query("from") from?: string, @Query("to") to?: string) {
    this.access.assertCan(s, "auditLogs", "export");
    const rows = await this.db.query(
      `SELECT created_at AS date, user_name AS "user", role, action, entity, entity_id AS "record", ip, changes::text AS details FROM audit_logs
       WHERE ($1::date IS NULL OR created_at >= $1::date) AND ($2::date IS NULL OR created_at < $2::date + 1) ORDER BY created_at DESC`,
      [from || null, to || null],
    );
    await this.access.audit(s, "Audit Log Exported", "auditLogs", null, { rows: rows.length });
    sendCsv(res, "audit-logs.csv", rows);
  }

  // ----------------------------------------------------------------------- files
  @Post("files")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: config.maxUploadMb * 1024 * 1024 } }))
  async upload(@CurrentSession() s: Session, @UploadedFile() file?: { originalname: string; mimetype: string; size: number; buffer: Buffer }) {
    if (!file) throw new HttpError(400, "Attach a file in the `file` field");
    const key = `${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}${path.extname(file.originalname)}`;
    await this.storage.put(key, file.buffer, file.mimetype);
    const sum = crypto.createHash("sha256").update(file.buffer).digest("hex");
    try {
      return await this.db.one(
        `INSERT INTO files (storage_key, file_name, mime_type, size_bytes, checksum_sha256, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id, file_name AS "fileName", mime_type AS "mimeType", size_bytes AS "sizeBytes"`,
        [key, file.originalname, file.mimetype, file.size, sum, s.userId],
      );
    } catch (e) {
      await this.storage.remove(key).catch(() => undefined); // don't leave an orphaned object behind
      throw e;
    }
  }

  @Get("files/:id/url")
  async fileUrl(@Param("id") id: string) {
    const f = await this.db.one<{ storage_key: string; file_name: string }>("SELECT storage_key, file_name FROM files WHERE id=$1", [id]);
    if (!f) throw new HttpError(404, "File not found");
    if (this.storage.driver === "supabase" && !f.storage_key.startsWith("placeholder/")) return { url: await this.storage.signedUrl(f.storage_key, f.file_name), expiresIn: 300 };
    return { url: `/api/v1/files/${id}/download`, expiresIn: 300 };
  }

  @Get("files/:id/download")
  async download(@Param("id") id: string, @Res() res: Response) {
    const f = await this.db.one<{ storage_key: string; file_name: string; mime_type: string }>("SELECT storage_key, file_name, mime_type FROM files WHERE id=$1", [id]);
    if (!f) throw new HttpError(404, "File not found");
    if (f.storage_key.startsWith("placeholder/")) throw new HttpError(404, "This file has only metadata (demo data) — upload a real file to download it");
    // Supabase: send the browser to a short-lived signed link instead of streaming through the API
    if (this.storage.driver === "supabase") return res.redirect(302, await this.storage.signedUrl(f.storage_key, f.file_name));
    const full = this.storage.localPath(f.storage_key);
    if (!full) throw new HttpError(404, "File not found in storage");
    res.setHeader("Content-Type", f.mime_type);
    res.setHeader("Content-Disposition", `attachment; filename="${f.file_name}"`);
    fs.createReadStream(full).pipe(res);
  }
}
