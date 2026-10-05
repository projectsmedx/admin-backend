import { HttpException, Injectable, Logger } from "@nestjs/common";
import { DbService } from "../database/db.service.js";
import { Repo } from "./repository.service.js";
import type { Row } from "./resources.js";
import { PERMISSIONS, ROLES, type Action, type PermissionMatrix, type Resource, type Role, type Scope } from "./rbac.js";

export interface Session {
  userId: string;
  email: string;
  name: string;
  role: Role;
  employeeId: string | null;
  ip?: string;
  userAgent?: string;
}

export class HttpError extends HttpException {
  constructor(status: number, message: string) {
    super(message, status);
  }
}

/** Which field links a record to an employee, for own/team/department scoping. */
export const OWNER_FIELD: Record<string, string> = {
  employees: "id", users: "employeeId", leaves: "employeeId", attendance: "employeeId", attendanceCorrections: "employeeId",
  timesheets: "employeeId", documents: "employeeId", loans: "employeeId", salaryRevisions: "employeeId", settlements: "employeeId",
  onboarding: "employeeId", reviews: "employeeId", kpis: "employeeId", expenses: "employeeId", tickets: "employeeId",
  offboarding: "employeeId", cases: "employeeId", recognitions: "employeeId", goals: "ownerId", assets: "assignedTo",
};

export const SELF_EDITABLE: Record<string, string[]> = {
  employees: ["phone", "personalEmail", "address", "emergencyContact", "maritalStatus", "skills"],
  leaves: ["from", "to", "days", "reason", "halfDay", "leaveTypeId", "attachment"],
  tickets: ["description", "priority", "comments"],
  goals: ["progress", "keyResults", "status"],
  reviews: ["selfScore", "strengths", "improvements"],
  timesheets: ["date", "project", "task", "hours", "overtime", "notes", "billable"],
  onboarding: ["tasks"],
};

const ROLE_GROUPS: Record<string, string[]> = { all: [...ROLES], hr: ["super_admin", "hr_admin", "hr_manager"], finance: ["super_admin", "finance"] };

@Injectable()
export class AccessService {
  private readonly log = new Logger("Access");
  private matrix: Record<string, PermissionMatrix> = PERMISSIONS;

  constructor(private readonly db: DbService, private readonly repo: Repo) {}

  // ----------------------------------------------------------------------- permissions (from DB)
  async loadPermissions() {
    const rows = await this.db.query<{ key: string; resource: string; actions: string[]; scope: Scope }>(
      "SELECT r.key, p.resource, p.actions, p.scope FROM role_permissions p JOIN roles r ON r.id = p.role_id",
    );
    if (!rows.length) return;
    const m: Record<string, PermissionMatrix> = {};
    for (const r of rows) (m[r.key] ??= {})[r.resource as Resource] = { actions: r.actions as Action[], scope: r.scope };
    this.matrix = m;
    this.log.log(`Loaded permissions for ${Object.keys(m).length} roles`);
  }

  permissions(role: Role): PermissionMatrix {
    return this.matrix[role] ?? {};
  }
  can(role: Role, resource: Resource, action: Action = "view") {
    return !!this.matrix[role]?.[resource]?.actions.includes(action);
  }
  scopeOf(role: Role, resource: Resource): Scope | null {
    return this.matrix[role]?.[resource]?.scope ?? null;
  }
  assertCan(s: Session, resource: Resource, action: Action) {
    if (!this.can(s.role, resource, action)) throw new HttpError(403, `You don't have permission to ${action} ${resource}`);
  }
  isHR(role: Role) {
    return role === "super_admin" || role === "hr_admin" || role === "hr_manager";
  }

  // ----------------------------------------------------------------------- scopes
  async reportsOf(managerId: string | null): Promise<Set<string>> {
    if (!managerId) return new Set();
    const rows = await this.db.query<{ id: string }>(
      `WITH RECURSIVE r AS (SELECT id FROM employees WHERE manager_id = $1 AND deleted_at IS NULL
         UNION SELECT e.id FROM employees e JOIN r ON e.manager_id = r.id WHERE e.deleted_at IS NULL) SELECT id FROM r`,
      [managerId],
    );
    return new Set(rows.map((r) => r.id));
  }

  async scopePredicate(s: Session, resource: Resource): Promise<(employeeId: string | null | undefined) => boolean> {
    const scope = this.scopeOf(s.role, resource);
    const me = s.employeeId;
    if (scope === "all") return () => true;
    if (scope === "own") return (id) => !!id && id === me;
    if (scope === "team") {
      const team = await this.reportsOf(me);
      return (id) => !!id && (id === me || team.has(id));
    }
    if (scope === "department") {
      const rows = await this.db.query<{ id: string }>("SELECT e.id FROM employees e JOIN employees me ON me.department_id = e.department_id WHERE me.id = $1", [me]);
      const set = new Set(rows.map((r) => r.id));
      return (id) => !!id && set.has(id);
    }
    return () => false;
  }

  async filterByScope<T extends Row>(s: Session, key: string, resource: Resource, rows: T[]): Promise<T[]> {
    const field = OWNER_FIELD[key];
    const scope = this.scopeOf(s.role, resource);
    const inScope = await this.scopePredicate(s, resource);
    let out = rows;
    if (key === "payrollRuns" && scope !== "all") {
      out = rows
        .map((r) => ({ ...r, items: (r.items as { employeeId: string }[]).filter((i) => inScope(i.employeeId)), totals: undefined }) as T)
        .filter((r) => (r.items as unknown[]).length > 0 && ["Approved", "Paid", "Locked"].includes(String(r.status)));
    } else if (field && scope !== "all") {
      out = rows.filter((r) => {
        const owner = r[field] as string | null;
        if (key === "documents" && owner == null) return true;
        return inScope(owner);
      });
    }
    if (key === "cases" && !["super_admin", "hr_manager"].includes(s.role)) out = out.filter((r) => !r.confidential || r.employeeId === s.employeeId);
    if (key === "employees") out = out.map((r) => this.maskEmployee(s, r));
    if (key === "users") out = out.map(({ passwordHash: _p, ...u }) => u as unknown as T);
    return out;
  }

  async assertInScope(s: Session, key: string, resource: Resource, row: Row) {
    if ((await this.filterByScope(s, key, resource, [row])).length === 0) throw new HttpError(403, "This record is outside your access scope");
  }

  // ----------------------------------------------------------------------- masking
  maskEmployee<T extends Row>(s: Session, e: T): T {
    const own = e.id === s.employeeId;
    if (own || this.can(s.role, "compensation", "view")) return e;
    const mask = (v: unknown, keep = 4) => (typeof v === "string" && v.length > keep ? "•".repeat(v.length - keep) + v.slice(-keep) : v);
    const c: Record<string, any> = { ...e };
    delete c.salary;
    if (c.bank) c.bank = { name: c.bank.name, iban: mask(c.bank.iban), routingCode: "•••" };
    if (!this.isHR(s.role)) {
      c.emiratesId = mask(c.emiratesId);
      c.passportNumber = mask(c.passportNumber, 3);
      c.laborCardNumber = mask(c.laborCardNumber, 3);
      c.dateOfBirth = typeof c.dateOfBirth === "string" ? `••••-${c.dateOfBirth.slice(5)}` : c.dateOfBirth;
    }
    return c as T;
  }

  // ----------------------------------------------------------------------- audit & notifications
  async audit(s: Partial<Session> | null, action: string, entity: string, entityId: string | null, details: unknown = {}) {
    await this.db.query(
      "INSERT INTO audit_logs (user_id, user_name, role, action, entity, entity_id, changes, ip, user_agent) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [s?.userId ?? null, s?.name ?? "System", s?.role && ROLES.includes(s.role as Role) ? s.role : null, action, entity, entityId, JSON.stringify(details ?? {}), s?.ip ?? null, s?.userAgent ?? null],
    );
  }

  diff(before: Record<string, any>, after: Record<string, any>) {
    const changes: { field: string; old: unknown; new: unknown }[] = [];
    for (const k of Object.keys(after)) {
      const a = before[k], b = after[k];
      if (JSON.stringify(a) === JSON.stringify(b) || k === "updatedAt" || k === "passwordHash") continue;
      if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a)) {
        for (const sub of Object.keys(b)) if (JSON.stringify(a[sub]) !== JSON.stringify(b[sub])) changes.push({ field: `${k}.${sub}`, old: a[sub], new: b[sub] });
      } else changes.push({ field: k, old: Array.isArray(a) ? `${a.length} items` : a, new: Array.isArray(b) ? `${b.length} items` : b });
    }
    return changes;
  }

  /** In-app notification (+ queued email for direct recipients when email notifications are on). */
  async notify(target: { employeeId?: string | null; userId?: string; role?: string }, title: string, message: string, link = "/") {
    let userId = target.userId;
    if (!userId && target.employeeId) userId = (await this.db.one<{ id: string }>("SELECT id FROM users WHERE employee_id=$1", [target.employeeId]))?.id;
    if (!userId && !target.role) return;
    await this.db.query("INSERT INTO notifications (user_id, role_group, title, message, link) VALUES ($1,$2,$3,$4,$5)", [userId ?? null, target.role ?? null, title, message, link]);
    if (userId) {
      const emailOn = await this.db.one<{ value: unknown }>("SELECT value FROM settings WHERE section='notifications' AND key='email'");
      if (emailOn?.value !== false) {
        const u = await this.db.one<{ email: string; display_name: string }>("SELECT email, display_name FROM users WHERE id=$1 AND is_active", [userId]);
        if (u) await this.db.query("INSERT INTO email_outbox (to_email, template, payload) VALUES ($1,'notification',$2)", [u.email, JSON.stringify({ name: u.display_name, title, message, link })]);
      }
    }
  }

  roleGroupMembers(group: string) {
    return ROLE_GROUPS[group] ?? [group];
  }

  async employeeName(id: string | null | undefined) {
    if (!id) return "—";
    const r = await this.db.one<{ n: string }>("SELECT first_name || ' ' || last_name AS n FROM employees WHERE id=$1", [id]);
    return r?.n ?? id;
  }

  async settings<T = Record<string, Record<string, unknown>>>(): Promise<T> {
    const rows = await this.db.query<{ section: string; key: string; value: unknown }>("SELECT section, key, value FROM settings");
    const out: Record<string, Record<string, unknown>> = {};
    for (const r of rows) (out[r.section] ??= {})[r.key] = r.value;
    return out as T;
  }

  get repository() {
    return this.repo;
  }
}
