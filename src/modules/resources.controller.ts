import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from "@nestjs/common";
import { DbService } from "../database/db.service.js";
import { CurrentSession } from "../auth/auth.guard.js";
import { AccessService, HttpError, type Session } from "../domain/access.service.js";
import { HooksService } from "../domain/hooks.service.js";
import { Repo } from "../domain/repository.service.js";
import { WorkflowsService } from "../domain/workflows.service.js";
import { DEF_BY_PATH, isUuid, type Def, type Row } from "../domain/resources.js";

const NOT_ROUTED = new Set(["notifications"]);
const READ_ONLY = new Set(["auditLogs"]);
const SYSTEM_QUERY = new Set(["q", "sort", "limit", "page", "dateFrom", "dateTo", "pendingForMe"]);

/**
 * Generic REST endpoints for every resource in DEFS:
 *   GET /:resource, GET /:resource/:id, POST /:resource, PATCH|PUT /:resource/:id, DELETE /:resource/:id,
 *   POST /:resource/:id/:action (workflow transitions such as approve, reject, cancel…)
 * Registered last so dedicated controllers win for overlapping paths.
 */
@Controller()
export class ResourcesController {
  constructor(
    private readonly db: DbService,
    private readonly repo: Repo,
    private readonly access: AccessService,
    private readonly hooks: HooksService,
    private readonly flows: WorkflowsService,
  ) {}

  private resolve(path: string): Def {
    const def = DEF_BY_PATH.get(path);
    if (!def || NOT_ROUTED.has(def.key)) throw new HttpError(404, `Unknown resource "${path}"`);
    return def;
  }

  private async load(def: Def, id: string) {
    if (!isUuid(id)) throw new HttpError(404, "Record not found");
    const row = await this.repo.get(def.key, id);
    if (!row) throw new HttpError(404, "Record not found");
    return row;
  }

  @Get(":resource")
  async list(@CurrentSession() s: Session, @Param("resource") path: string, @Query() query: Record<string, string>) {
    const def = this.resolve(path);
    this.access.assertCan(s, def.resource, "view");
    const where: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(query)) if (!SYSTEM_QUERY.has(k)) where[k] = v.includes(",") && !["q"].includes(k) ? v.split(",") : v;
    let rows = await this.access.filterByScope(s, def.key, def.resource, await this.repo.all(def.key, where));
    if (query.dateFrom) rows = rows.filter((r) => String(r.date ?? r.from ?? "") >= query.dateFrom);
    if (query.dateTo) rows = rows.filter((r) => String(r.date ?? r.to ?? "") <= query.dateTo);
    const q = query.q?.toLowerCase();
    if (q) rows = rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q));
    if (query.sort) {
      const desc = query.sort.startsWith("-");
      const key = query.sort.replace(/^-/, "");
      rows = [...rows].sort((a, b) => (String(a[key] ?? "") < String(b[key] ?? "") ? -1 : 1) * (desc ? -1 : 1));
    }
    if (query.page) {
      const page = Math.max(1, Number(query.page)), limit = Math.min(500, Math.max(1, Number(query.limit ?? 25)));
      return { data: rows.slice((page - 1) * limit, page * limit), meta: { page, limit, total: rows.length, pages: Math.ceil(rows.length / limit) } };
    }
    if (Number(query.limit) > 0) rows = rows.slice(0, Number(query.limit));
    return rows;
  }

  @Get(":resource/:id")
  async get(@CurrentSession() s: Session, @Param("resource") path: string, @Param("id") id: string) {
    const def = this.resolve(path);
    this.access.assertCan(s, def.resource, "view");
    const row = await this.load(def, id);
    await this.access.assertInScope(s, def.key, def.resource, row);
    return (await this.access.filterByScope(s, def.key, def.resource, [row]))[0];
  }

  /** GET /:resource/:id/approvals — approval history for workflow resources (leaves, expenses, salary revisions). */
  @Get(":resource/:id/approvals")
  async approvals(@CurrentSession() s: Session, @Param("resource") path: string, @Param("id") id: string) {
    const row = await this.get(s, path, id);
    return (row?.approvals as unknown[]) ?? [];
  }

  @Post(":resource")
  async create(@CurrentSession() s: Session, @Param("resource") path: string, @Body() body: Record<string, unknown>) {
    const def = this.resolve(path);
    if (READ_ONLY.has(def.key)) throw new HttpError(405, "Read-only resource");
    this.access.assertCan(s, def.resource, "create");
    const row = await this.db.tx(async () => {
      const data = await this.hooks.beforeCreate(def.key, def.resource, body ?? {}, s);
      const created = await this.repo.insert(def.key, data);
      await this.hooks.afterCreate(def.key, created, body ?? {}, s);
      await this.access.audit(s, "Created", def.key, created.id, { code: created.code, summary: created.name ?? created.title ?? created.type ?? created.subject ?? null });
      return created;
    });
    return (await this.access.filterByScope(s, def.key, def.resource, [row]))[0] ?? row;
  }

  @Patch(":resource/:id")
  async patch(@CurrentSession() s: Session, @Param("resource") path: string, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const def = this.resolve(path);
    if (READ_ONLY.has(def.key)) throw new HttpError(405, "Read-only resource");
    this.access.assertCan(s, def.resource, "edit");
    const record = await this.load(def, id);
    await this.access.assertInScope(s, def.key, def.resource, record);
    const updated = await this.db.tx(async () => {
      const patch = await this.hooks.beforeUpdate(def.key, def.resource, record, body ?? {}, s);
      const u = await this.repo.update(def.key, id, patch);
      const changes = this.access.diff(record, patch);
      await this.access.audit(s, changes.some((c) => c.field.startsWith("salary.")) ? "Salary Updated" : "Updated", def.key, id, { code: record.code, changes });
      return u!;
    });
    return (await this.access.filterByScope(s, def.key, def.resource, [updated]))[0] ?? updated;
  }

  @Put(":resource/:id")
  put(@CurrentSession() s: Session, @Param("resource") path: string, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.patch(s, path, id, body);
  }

  @Delete(":resource/:id")
  async remove(@CurrentSession() s: Session, @Param("resource") path: string, @Param("id") id: string) {
    const def = this.resolve(path);
    if (READ_ONLY.has(def.key)) throw new HttpError(405, "Read-only resource");
    this.access.assertCan(s, def.resource, "delete");
    const record = await this.load(def, id);
    await this.access.assertInScope(s, def.key, def.resource, record);
    await this.db.tx(async () => {
      await this.hooks.beforeDelete(def.key, record, s);
      await this.repo.remove(def.key, id);
      await this.access.audit(s, "Deleted", def.key, id, { snapshot: { ...record, passwordHash: undefined } });
    });
    return { ok: true };
  }

  @Post(":resource/:id/:action")
  @HttpCode(200)
  async action(@CurrentSession() s: Session, @Param("resource") path: string, @Param("id") id: string, @Param("action") action: string, @Body() body: Record<string, unknown>) {
    const def = this.resolve(path);
    this.access.assertCan(s, def.resource, "view");
    const record = await this.load(def, id);
    const updated = await this.db.tx(async () => {
      const { patch, message } = await this.flows.run(def.key, def.resource, action, s, record, body ?? {});
      const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
      const u = await this.repo.update(def.key, id, clean);
      const label = action.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      await this.access.audit(s, label.charAt(0).toUpperCase() + label.slice(1), def.key, id, { code: record.code, action, comment: body?.comment ?? body?.reason ?? undefined, status: clean.status ?? clean.stage });
      return { message, row: u as Row };
    });
    return { message: updated.message, record: (await this.access.filterByScope(s, def.key, def.resource, [updated.row]))[0] ?? null };
  }
}
