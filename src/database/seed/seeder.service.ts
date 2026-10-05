import { Injectable, Logger } from "@nestjs/common";
import { DbService } from "../db.service.js";
import { Repo } from "../../domain/repository.service.js";
import { PERMISSIONS, ROLES, ROLE_LABELS } from "../../domain/rbac.js";
import { config } from "../../config.js";
import { generate } from "./generate.js";

type Obj = Record<string, any>;

// Fields that reference another collection (by the generator's human-readable ids)
const REFS: Record<string, string> = {
  employeeId: "employees", managerId: "employees", departmentId: "departments", designationId: "designations", locationId: "locations",
  shiftId: "shifts", leaveTypeId: "leaveTypes", jobId: "jobs", candidateId: "candidates", interviewerId: "employees", recruiterId: "employees",
  hiringManagerId: "employees", assignedTo: "employees", ownerId: "employees", reviewerId: "employees", authorId: "employees", givenBy: "employees",
  buddyId: "employees", currentDesignationId: "designations", newDesignationId: "designations", reviewedBy: "employees", userId: "users",
};
// Generator stores these as employee ids; the database references users
const EMPLOYEE_TO_USER = ["createdBy", "approvedBy", "uploadedBy"];
// Collections whose generator id becomes the human-readable `code`
const KEEP_CODE = new Set(["employees", "leaves", "jobs", "candidates", "tickets", "expenses", "assets", "cases"]);

const ORDER = [
  "locations", "departments", "designations", "shifts", "leaveTypes", "holidays", "employees", "users", "leaves", "attendance",
  "attendanceCorrections", "timesheets", "documents", "payrollRuns", "loans", "salaryRevisions", "jobs", "candidates", "interviews",
  "offers", "onboarding", "goals", "reviews", "kpis", "expenses", "assets", "trainings", "tickets", "announcements", "offboarding",
  "settlements", "cases", "recognitions", "surveys", "notifications", "auditLogs",
];

/** Loads the demo organization into an empty database. */
@Injectable()
export class SeederService {
  private readonly log = new Logger("Seed");
  constructor(private readonly db: DbService, private readonly repo: Repo) {}

  async isEmpty() {
    return Number((await this.db.one<{ c: number }>("SELECT count(*)::int c FROM users"))?.c ?? 0) === 0;
  }

  async runIfEmpty() {
    if (!config.seedOnStart) return;
    if (!(await this.isEmpty())) {
      this.log.log("Database already has data — skipping demo seed");
      return;
    }
    await this.seed();
  }

  async seed() {
    if (!config.seedPassword) throw new Error("SEED_PASSWORD is required to seed demo data (or set SEED_ON_START=false)");
    const started = Date.now();
    const data = generate(config.seedDate ? new Date(`${config.seedDate}T05:00:00Z`) : new Date(), config.seedPassword) as Obj;
    const ids: Record<string, Map<string, string>> = {};
    const map = (col: string, old: unknown) => (typeof old === "string" ? (ids[col]?.get(old) ?? old) : old);
    const empToUser = new Map<string, string>();

    const translate = (key: string, row: Obj): Obj => {
      const out: Obj = {};
      for (const [k, v] of Object.entries(row)) {
        if (k === "id") continue;
        if (REFS[k]) out[k] = map(REFS[k], v);
        else if (EMPLOYEE_TO_USER.includes(k)) out[k] = typeof v === "string" ? (empToUser.get(map("employees", v) as string) ?? null) : v;
        else if (k === "enrolled") out[k] = (v as string[]).map((x) => map("employees", x));
        else if ((k === "approvals" || k === "comments") && Array.isArray(v)) out[k] = (v as Obj[]).map((a) => ({ ...a, by: map("employees", a.by) }));
        else if (k === "items") out[k] = (v as Obj[]).map((i) => ({ ...i, employeeId: map("employees", i.employeeId) }));
        else out[k] = v;
      }
      if (KEEP_CODE.has(key)) out.code = row.id;
      return out;
    };

    await this.db.tx(async () => {
      // Roles & permission matrix
      for (const role of ROLES) {
        const r = await this.db.one<{ id: string }>("INSERT INTO roles (key, name, description, is_system) VALUES ($1,$2,$3,true) RETURNING id", [role, ROLE_LABELS[role], `${ROLE_LABELS[role]} (system role)`]);
        for (const [resource, g] of Object.entries(PERMISSIONS[role])) await this.db.query("INSERT INTO role_permissions (role_id, resource, actions, scope) VALUES ($1,$2,$3,$4)", [r!.id, resource, g!.actions, g!.scope]);
      }
      // Settings + company profile
      for (const [section, values] of Object.entries(data.settings as Obj)) {
        if (section === "id") continue;
        for (const [key, value] of Object.entries(values as Obj)) await this.db.query("INSERT INTO settings (section, key, value) VALUES ($1,$2,$3)", [section, key, JSON.stringify(value)]);
      }
      const c = data.settings.company;
      await this.db.query(
        "INSERT INTO company (name, legal_name, trade_license, trn, mol_establishment_id, email, phone, website, address, currency, timezone, weekend_days) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
        [c.name, c.legalName, c.tradeLicense, c.trn, c.molEstablishmentId, c.email, c.phone, c.website, c.address, c.currency, c.timezone, [6, 0]],
      );
      for (const [k, [title, category, owner]] of (data.onboardingTemplate as [string, string, string][]).entries()) {
        await this.db.query("INSERT INTO onboarding_task_templates (title, category, owner_role, due_offset_days, sort_order) VALUES ($1,$2,$3,$4,$5)", [title, category, owner, k < 8 ? -2 : 5, k]);
      }

      for (const key of ORDER) {
        const rows = (data[key] ?? []) as Obj[];
        ids[key] = new Map();
        const bulk = ["attendance", "documents", "timesheets", "kpis", "auditLogs", "notifications"].includes(key);
        for (const row of rows) {
          let input = translate(key, row);
          if (key === "departments") input = { ...input, managerId: null };
          if (key === "payrollRuns") input = { ...input, workingDays: input.workingDays ?? 22, approvedBy: input.approvedBy ?? null };
          if (key === "employees" && input.status === "Resigned") input.lastWorkingDay = row.lastWorkingDay;
          if (key === "notifications" && typeof row.userId === "string" && !ids.users.has(row.userId)) continue;
          const created = await this.repo.insert(key, input, { fetch: !bulk });
          ids[key].set(row.id, created.id);
          if (key === "users" && input.employeeId) empToUser.set(input.employeeId, created.id);
        }
        if (key === "employees") {
          for (const d of data.departments as Obj[]) if (d.managerId) await this.db.query("UPDATE departments SET manager_id=$2 WHERE id=$1", [ids.departments.get(d.id), ids.employees.get(d.managerId)]);
        }
        if (rows.length) this.log.log(`${key}: ${rows.length}`);
      }
    });
    this.log.log(`Demo data seeded in ${((Date.now() - started) / 1000).toFixed(1)}s — sign in with admin@medxpharmacy.com and SEED_PASSWORD`);
  }

  /** Drops every table (used by `npm run db:reset`). */
  async reset() {
    await this.db.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    this.log.warn("Database schema dropped");
  }
}
