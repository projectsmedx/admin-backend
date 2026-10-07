// Replaces every employee (and all records tied to employees) with the list in a JSON file,
// and creates one login per employee: username = employee code, unique random password.
//   node scripts/load-employees.mjs backups/employees.json            → checks the file, changes nothing
//   node scripts/load-employees.mjs backups/employees.json --apply    → backs up the database, then replaces
// Departments, designations, branches, shifts, leave types, holidays, settings and roles are kept.
// The new logins are written to ../medx-logins-<date>.csv (outside every git repo). Keep that file private.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(ROOT, "package.json"));
const pg = require("pg");
const bcrypt = require("bcryptjs");

const [file, flag] = process.argv.slice(2);
if (!file) throw new Error("Usage: node scripts/load-employees.mjs <employees.json> [--apply]");
const apply = flag === "--apply";
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env"), "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
/** Percent-encodes the password so one containing "@" or ":" still parses (pg_dump is strict about this). */
function encodePassword(url) {
  const at = url.lastIndexOf("@"), start = url.indexOf("://") + 3, colon = url.indexOf(":", start);
  if (at < 0 || colon < 0 || colon > at) return url;
  return url.slice(0, colon + 1) + encodeURIComponent(decodeURIComponent(url.slice(colon + 1, at))) + url.slice(at);
}
const DATABASE_URL = encodePassword(process.env.DATABASE_URL ?? env.DATABASE_URL);

// Everything that belongs to the old employees. Tables outside this list are kept.
const WIPE = [
  "approval_steps", "asset_assignments", "asset_maintenance", "assets", "attendance_corrections", "attendance_records", "audit_logs",
  "candidate_stage_history", "candidates", "document_reminders", "document_versions", "documents", "email_outbox",
  "employee_bank_accounts", "employee_emergency_contacts", "loan_repayments", "employee_loans", "employee_skills", "er_case_notes", "er_cases",
  "exit_checklist_items", "exits", "expense_claims", "final_settlement_lines", "final_settlements", "key_results", "goals", "interviews",
  "job_requisitions", "kpis", "leave_balances", "leave_requests", "notification_reads", "notifications", "offers", "onboarding_tasks",
  "onboarding_processes", "payroll_items", "payroll_runs", "performance_reviews", "recognitions", "refresh_tokens", "salary_revisions",
  "salary_structures", "saved_reports", "shift_assignments", "survey_responses", "surveys", "ticket_comments", "tickets", "timesheet_entries",
  "training_enrollments", "training_programs", "announcements", "projects", "review_cycles", "teams", "users", "employees",
];
const ROLES = ["super_admin", "manager", "pharmacist", "developer", "marketing", "customer_support"];

// ----------------------------------------------------------------------------- validate the file
const people = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
const problems = [];
const codes = new Set(people.map((p) => p.code));
for (const p of people) {
  const who = p.code ?? JSON.stringify(p);
  for (const k of ["code", "firstName", "lastName", "email", "department", "designation", "role"]) if (!p[k]) problems.push(`${who}: missing ${k}`);
  if (p.role && !ROLES.includes(p.role)) problems.push(`${who}: role must be one of ${ROLES.join(", ")}`);
  if (p.engagementType && !["internal", "outsource", "other"].includes(p.engagementType)) problems.push(`${who}: engagementType must be internal, outsource or other`);
  if (p.managerCode && !codes.has(p.managerCode)) problems.push(`${who}: manager ${p.managerCode} is not in the file`);
}
if (codes.size !== people.length) problems.push("Employee codes must be unique");
if (new Set(people.map((p) => p.email.toLowerCase())).size !== people.length) problems.push("Emails must be unique");
const roots = people.filter((p) => !p.managerCode);
if (roots.length !== 1) problems.push(`Exactly one person (the CEO) should have no manager; found ${roots.length}: ${roots.map((r) => r.code).join(", ")}`);
if (!people.some((p) => p.role === "super_admin")) problems.push("At least one person needs role super_admin, or nobody can add employees");
if (problems.length) {
  console.error("Fix these in the file first:\n - " + problems.join("\n - "));
  process.exit(1);
}
console.log(`${people.length} employees OK. CEO: ${roots[0].firstName} ${roots[0].lastName}.`);
if (!apply) {
  console.log("Dry run — nothing changed. Add --apply to back up the database and replace all employees.");
  process.exit(0);
}

// ----------------------------------------------------------------------------- back up
const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 13).replace("T", "-");
const backup = path.join(ROOT, `backups/before-load-employees-${stamp}.sql`);
fs.mkdirSync(path.dirname(backup), { recursive: true });
console.log(`Backing up to ${path.relative(ROOT, backup)}…`);
execFileSync("pg_dump", ["--no-owner", "--no-privileges", "--schema=public", "-f", backup, DATABASE_URL], { stdio: "inherit" });

// ----------------------------------------------------------------------------- replace
const db = new pg.Client({ connectionString: DATABASE_URL, ssl: DATABASE_URL.includes("supabase") ? { rejectUnauthorized: false } : undefined });
await db.connect();
const q = async (sql, params) => (await db.query(sql, params)).rows;
const password = () => {
  // 12 characters, always with upper, lower and a digit; no look-alike characters
  const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnpqrstuvwxyz", "23456789"];
  const all = sets.join("");
  const chars = [...sets.map((s) => s[crypto.randomInt(s.length)]), ...Array.from({ length: 9 }, () => all[crypto.randomInt(all.length)])];
  for (let i = chars.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join("");
};

const logins = [];
try {
  await q("BEGIN");
  const existing = new Set((await q("SELECT tablename FROM pg_tables WHERE schemaname='public'")).map((r) => r.tablename));
  const wipe = WIPE.filter((t) => existing.has(t));
  // Kept tables that point at wiped rows (e.g. a branch manager) are cleared instead of deleted
  const refs = await q(
    `SELECT c.conrelid::regclass::text AS tbl, a.attname AS col, a.attnotnull AS notnull FROM pg_constraint c
     JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
     WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace AND c.confrelid::regclass::text = ANY ($1) AND NOT (c.conrelid::regclass::text = ANY ($1))`,
    [wipe],
  );
  for (const r of refs) {
    if (r.notnull) throw new Error(`${r.tbl}.${r.col} must point at an employee/user; add ${r.tbl} to WIPE or handle it first`);
    await q(`UPDATE ${r.tbl} SET ${r.col} = NULL WHERE ${r.col} IS NOT NULL`);
  }
  // DELETE rather than TRUNCATE (kept tables hold foreign keys to these). Retry until foreign-key order works out.
  let left = [...wipe];
  for (let pass = 0; left.length && pass < wipe.length; pass++) {
    const failed = [];
    for (const t of left) {
      await q("SAVEPOINT del");
      try {
        await q(`DELETE FROM ${t}`);
        await q("RELEASE SAVEPOINT del");
      } catch (e) {
        if (e.code !== "23503") throw e;
        await q("ROLLBACK TO SAVEPOINT del");
        failed.push(t);
      }
    }
    left = failed;
  }
  if (left.length) throw new Error(`Could not clear ${left.join(", ")} because of foreign keys`);
  console.log(`Removed old data from ${wipe.length} tables${refs.length ? `; cleared ${refs.map((r) => `${r.tbl}.${r.col}`).join(", ")}` : ""}.`);

  const deptId = async (name) => {
    const found = (await q("SELECT id FROM departments WHERE lower(name)=lower($1)", [name]))[0];
    if (found) return found.id;
    let code = name.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || "DEP";
    for (let n = 2; (await q("SELECT 1 FROM departments WHERE code=$1", [code])).length; n++) code = `${code.slice(0, 3)}${n}`;
    return (await q("INSERT INTO departments (name, code) VALUES ($1,$2) RETURNING id", [name, code]))[0].id;
  };
  const desigId = async (title, departmentId, level) => {
    const found = (await q("SELECT id FROM designations WHERE lower(title)=lower($1)", [title]))[0];
    if (found) return found.id;
    return (await q("INSERT INTO designations (title, level, department_id) VALUES ($1,$2,$3) RETURNING id", [title, level || "Staff", departmentId]))[0].id;
  };
  const shift = (await q("SELECT id FROM shifts ORDER BY created_at LIMIT 1"))[0]?.id;
  const colors = ["#6366f1", "#ec4899", "#14b8a6", "#f97316", "#0ea5e9"];
  const today = new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);

  const idByCode = new Map();
  for (const [n, p] of people.entries()) {
    const departmentId = await deptId(p.department);
    const joining = p.joiningDate || today;
    const [row] = await q(
      `INSERT INTO employees (code, first_name, last_name, work_email, phone, department_id, designation_id, location_id, job_role, employment_type, work_mode, status, joining_date, engagement_type, avatar_color)
       VALUES ($1,$2,$3,$4,$5,$6,$7,(SELECT id FROM locations WHERE lower(name)=lower($8)),$9,$10,'office','active',$11,$12,$13) RETURNING id`,
      [p.code, p.firstName, p.lastName, p.email.toLowerCase(), p.phone || null, departmentId, await desigId(p.designation, departmentId, p.jobRole), p.branch || null, p.jobRole || null, p.employmentType || "full_time", joining, p.engagementType || "internal", colors[n % colors.length]],
    );
    idByCode.set(p.code, row.id);
    if (shift) await q("INSERT INTO shift_assignments (employee_id, shift_id, effective_from) VALUES ($1,$2,$3)", [row.id, shift, joining]);
    const pwd = password();
    await q(
      "INSERT INTO users (username, user_type, email, display_name, role, employee_id, password_hash, password_changed_at) VALUES ($1,'employee',$2,$3,$4,$5,$6,now())",
      [p.code, p.email.toLowerCase(), `${p.firstName} ${p.lastName}`, p.role, row.id, bcrypt.hashSync(pwd, 10)],
    );
    logins.push({ code: p.code, name: `${p.firstName} ${p.lastName}`, email: p.email.toLowerCase(), role: p.role, password: pwd });
  }
  for (const p of people) if (p.managerCode) await q("UPDATE employees SET manager_id=$1 WHERE id=$2", [idByCode.get(p.managerCode), idByCode.get(p.code)]);
  await q("COMMIT");
} catch (e) {
  await q("ROLLBACK");
  await db.end();
  console.error("Nothing was changed:", e.message);
  process.exit(1);
}
await db.end();

const out = path.resolve(ROOT, `../medx-logins-${stamp.slice(0, 8)}.csv`);
const csv = ["Employee ID / Username,Name,Email,Access role,Password", ...logins.map((l) => [l.code, l.name, l.email, l.role, l.password].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\n");
fs.writeFileSync(out, csv + "\n", { mode: 0o600 });
console.log(`Loaded ${logins.length} employees. Logins saved to ${out}`);
