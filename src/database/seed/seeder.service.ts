import { Injectable, Logger } from "@nestjs/common";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { DbService } from "../db.service.js";
import { Repo } from "../../domain/repository.service.js";
import { PERMISSIONS, ROLES, ROLE_LABELS } from "../../domain/rbac.js";
import { config } from "../../config.js";
import { reference } from "./reference.js";

type Obj = Record<string, any>;

/** One company employee in data/employees.json. Department and designation are matched by name (created if new). */
interface SeedEmployee {
  code: string;
  firstName: string;
  lastName: string;
  email: string;
  department: string;
  designation: string;
  role: string;
  managerCode?: string;
  jobRole?: string;
  engagementType?: "internal" | "outsource" | "other";
  branch?: string;
  joiningDate?: string;
}

const EMPLOYEES_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "../data/employees.json");
// Reference collections, in insert order; their ids ("DEP-1") are mapped to database ids as they are created
const ORDER = ["locations", "departments", "designations", "shifts", "leaveTypes", "holidays"];
const REFS: Record<string, string> = { departmentId: "departments", locationId: "locations" };

/** 12 characters with upper, lower and a digit; no look-alike characters. */
function randomPassword() {
  const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnpqrstuvwxyz", "23456789"];
  const all = sets.join("");
  const chars = [...sets.map((s) => s[crypto.randomInt(s.length)]), ...Array.from({ length: 9 }, () => all[crypto.randomInt(all.length)])];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

/** Loads the company setup and the real employees (data/employees.json) into an empty database. */
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
      this.log.log("Database already has data — skipping seed");
      return;
    }
    await this.seed();
  }

  async seed() {
    const started = Date.now();
    const data = reference(config.seedDate ? new Date(`${config.seedDate}T05:00:00Z`) : new Date()) as Obj;
    const people = JSON.parse(fs.readFileSync(EMPLOYEES_FILE, "utf8")) as SeedEmployee[];
    const ids: Record<string, Map<string, string>> = {};
    const logins: { code: string; name: string; email: string; role: string; password: string }[] = [];

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
        ids[key] = new Map();
        for (const row of data[key] as Obj[]) {
          const input: Obj = {};
          for (const [k, v] of Object.entries(row)) if (k !== "id") input[k] = REFS[k] ? (ids[REFS[k]]?.get(v as string) ?? null) : v;
          ids[key].set(row.id, (await this.repo.insert(key, input, { fetch: false })).id);
        }
        this.log.log(`${key}: ${ids[key].size}`);
      }

      // Employees, each with a login: username = employee code, unique random password
      const byName = async (table: "departments" | "designations", col: "name" | "title", value: string, extra: Obj) => {
        const found = await this.db.one<{ id: string }>(`SELECT id FROM ${table} WHERE lower(${col}) = lower($1)`, [value]);
        return found?.id ?? (await this.repo.insert(table, { [col]: value, ...extra }, { fetch: false })).id;
      };
      const shiftId = ids.shifts.values().next().value;
      const today = new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);
      const colors = ["#6366f1", "#ec4899", "#14b8a6", "#f97316", "#0ea5e9"];
      const empId = new Map<string, string>();
      for (const [n, p] of people.entries()) {
        const departmentId = await byName("departments", "name", p.department, { code: p.department.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() + n });
        const designationId = await byName("designations", "title", p.designation, { level: p.jobRole || "Staff", departmentId });
        const location = p.branch ? await this.db.one<{ id: string }>("SELECT id FROM locations WHERE lower(name) = lower($1)", [p.branch]) : undefined;
        const emp = await this.repo.insert("employees", {
          code: p.code, firstName: p.firstName, lastName: p.lastName, email: p.email.toLowerCase(), departmentId, designationId, locationId: location?.id ?? null,
          jobRole: p.jobRole || null, engagementType: p.engagementType || "internal", employmentType: "Full-time", workMode: "Office", status: "Active",
          joiningDate: p.joiningDate || today, avatarColor: colors[n % colors.length], shiftId,
        });
        empId.set(p.code, emp.id);
        const password = randomPassword();
        await this.repo.insert("users", { username: p.code, userType: "Employee", email: p.email.toLowerCase(), name: `${p.firstName} ${p.lastName}`, role: p.role, employeeId: emp.id, passwordHash: bcrypt.hashSync(password, 10), passwordChangedAt: new Date().toISOString(), active: true }, { fetch: false });
        logins.push({ code: p.code, name: `${p.firstName} ${p.lastName}`, email: p.email.toLowerCase(), role: p.role, password });
      }
      for (const p of people) if (p.managerCode) await this.db.query("UPDATE employees SET manager_id=$1 WHERE id=$2", [empId.get(p.managerCode), empId.get(p.code)]);
      this.log.log(`employees: ${people.length}`);
    });

    // Passwords exist only in this file; it is written next to the project folder, outside the git repos
    const file = path.resolve(process.cwd(), "..", `medx-logins-${new Date().toISOString().slice(0, 10)}.csv`);
    const csv = ["Username,Name,Email,Access role,Password", ...logins.map((l) => [l.code, l.name, l.email, ROLE_LABELS[l.role as keyof typeof ROLE_LABELS] ?? l.role, l.password].map((v) => `"${v.replace(/"/g, '""')}"`).join(","))].join("\n");
    fs.writeFileSync(file, csv + "\n", { mode: 0o600 });
    this.log.log(`Seeded in ${((Date.now() - started) / 1000).toFixed(1)}s — logins saved to ${file}`);
  }

  /** Drops every table (used by `npm run db:reset`). */
  async reset() {
    await this.db.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    this.log.warn("Database schema dropped");
  }
}
