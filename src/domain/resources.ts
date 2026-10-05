// Declarative mapping between API objects (camelCase, labels) and PostgreSQL tables (snake_case, enums).
// Each definition also loads/saves its child tables so the API returns one complete object.
import type { EnumName } from "./enums.js";
import type { Resource } from "./rbac.js";

export type Row = { id: string; [k: string]: any };

export type Kind = "text" | "num" | "int" | "bool" | "date" | "ts" | "time" | "json" | "arr" | "enum" | "lc" | "file";
export interface Field {
  api: string;
  col?: string;
  kind?: Kind;
  enumName?: EnumName;
  ro?: boolean;
  /** Custom read from the raw DB row */
  get?: (db: Record<string, any>) => unknown;
  /** Custom write: returns column→value pairs */
  set?: (value: any, data: Row, existing: Row | undefined, h: Helpers) => Promise<Record<string, unknown>> | Record<string, unknown>;
}

export interface Helpers {
  q: <T = Record<string, any>>(sql: string, params?: unknown[]) => Promise<T[]>;
  one: <T = Record<string, any>>(sql: string, params?: unknown[]) => Promise<T | undefined>;
  fileId: (nameOrId: unknown) => Promise<string | null>;
  userIdForEmployee: (employeeId: string | null | undefined) => Promise<string | null>;
}

export interface Def {
  key: string;
  path: string;
  table: string;
  resource: Resource;
  fields: Field[];
  code?: string;
  orderBy?: string;
  softDelete?: boolean;
  /** entity_type in approval_steps; enables the `approvals` array */
  approvals?: string;
  /** child tables to delete first: [table, fk column] */
  children?: [string, string][];
  load?: (rows: Row[], h: Helpers) => Promise<void>;
  save?: (id: string, data: Row, h: Helpers, existing: Row | undefined) => Promise<void>;
}

// ----------------------------------------------------------------------------- field helpers
const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const f = (api: string, col = snake(api), kind: Kind = "text"): Field => ({ api, col, kind });
const n = (api: string, col = snake(api)) => f(api, col, "num");
const i = (api: string, col = snake(api)) => f(api, col, "int");
const b = (api: string, col = snake(api)) => f(api, col, "bool");
const d = (api: string, col = snake(api)) => f(api, col, "date");
const t = (api: string, col = snake(api)) => f(api, col, "ts");
const tm = (api: string, col = snake(api)) => f(api, col, "time");
const j = (api: string, col = snake(api)) => f(api, col, "json");
const a = (api: string, col = snake(api)) => f(api, col, "arr");
const lc = (api: string, col = snake(api)) => f(api, col, "lc");
const file = (api: string, col: string) => f(api, col, "file");
const en = (api: string, enumName: EnumName, col = snake(api)): Field => ({ api, col, kind: "enum", enumName });
const ro = (fl: Field): Field => ({ ...fl, ro: true });
const created = ro(t("createdAt"));
const updated = ro(t("updatedAt"));

const ids = (rows: Row[]) => rows.map((r) => r.id);
const group = <T extends Record<string, any>>(rows: T[], key: string) => {
  const m = new Map<string, T[]>();
  for (const r of rows) m.set(r[key], [...(m.get(r[key]) ?? []), r]);
  return m;
};
const iso = (v: any) => (v instanceof Date ? v.toISOString() : v ?? null);
const isUuid = (v: unknown) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

// Dubai is UTC+4 with no DST: wall-clock time ↔ timestamptz
const dubaiHHMM = (v: any) => (v ? new Date(new Date(v).getTime() + 4 * 3600000).toISOString().slice(11, 16) : null);
const dubaiDate = (v: any) => (v ? new Date(new Date(v).getTime() + 4 * 3600000).toISOString().slice(0, 10) : null);
const atDubai = (date: string, hhmm: string | null | undefined) => (hhmm ? `${date}T${hhmm.length === 5 ? `${hhmm}:00` : hhmm}+04:00` : null);

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function daysLabel(days: number[] | null) {
  if (!days?.length) return "";
  const s = [...days].sort((x, y) => x - y).join(",");
  if (s === "1,2,3,4,5") return "Mon-Fri";
  if (s === "1,2,3,4,5,6") return "Mon-Sat";
  if (s === "0,1,2,3,4,5,6") return "Rotating";
  return days.map((x) => DAY_NAMES[x]).join(", ");
}
function parseDays(v: unknown): number[] {
  if (Array.isArray(v)) return v.map(Number);
  const s = String(v ?? "").trim().toLowerCase();
  if (!s || s === "mon-fri") return [1, 2, 3, 4, 5];
  if (s === "mon-sat") return [1, 2, 3, 4, 5, 6];
  if (s === "rotating" || s === "all") return [0, 1, 2, 3, 4, 5, 6];
  const out = s.split(/[\s,]+/).map((x) => DAY_NAMES.findIndex((dn) => dn.toLowerCase() === x.slice(0, 3))).filter((x) => x >= 0);
  return out.length ? out : [1, 2, 3, 4, 5];
}

/** Loads approval history rows for a set of records. */
export async function loadApprovals(rows: Row[], entity: string, h: Helpers) {
  if (!rows.length) return;
  const steps = await h.q(
    `SELECT s.*, u.employee_id, u.display_name FROM approval_steps s LEFT JOIN users u ON u.id = s.approver_user_id
     WHERE s.entity_type = $1 AND s.entity_id = ANY($2) ORDER BY s.acted_at, s.step`,
    [entity, ids(rows)],
  );
  const g = group(steps, "entity_id");
  for (const r of rows) {
    r.approvals = (g.get(r.id) ?? []).map((s) => ({ by: s.employee_id, userId: s.approver_user_id, userName: s.display_name, role: s.approver_role, action: s.action.charAt(0).toUpperCase() + s.action.slice(1), at: iso(s.acted_at), comment: s.comment ?? "" }));
  }
}

/** Appends approval entries that are not stored yet (approval history is append-only). */
export async function saveApprovals(id: string, entity: string, list: any[] | undefined, h: Helpers) {
  if (!Array.isArray(list)) return;
  const existing = Number((await h.one<{ c: number }>("SELECT count(*)::int c FROM approval_steps WHERE entity_type=$1 AND entity_id=$2", [entity, id]))?.c ?? 0);
  for (const [k, s] of list.slice(existing).entries()) {
    const userId = s.userId ?? (await h.userIdForEmployee(s.by));
    if (!userId) continue;
    await h.q(
      "INSERT INTO approval_steps (entity_type, entity_id, step, approver_user_id, approver_role, action, comment, acted_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [entity, id, existing + k + 1, userId, ["super_admin", "hr_admin", "hr_manager", "finance", "manager", "employee"].includes(s.role) ? s.role : null, String(s.action ?? "approved").toLowerCase(), s.comment || null, s.at ?? new Date().toISOString()],
    );
  }
}

async function projectId(name: unknown, h: Helpers) {
  if (!name) return null;
  if (isUuid(name)) return name as string;
  const found = await h.one<{ id: string }>("SELECT id FROM projects WHERE lower(name) = lower($1)", [name]);
  if (found) return found.id;
  return (await h.one<{ id: string }>("INSERT INTO projects (name) VALUES ($1) RETURNING id", [name]))!.id;
}

async function cycleId(name: unknown, type: unknown, h: Helpers) {
  if (!name) return null;
  if (isUuid(name)) return name as string;
  const found = await h.one<{ id: string }>("SELECT id FROM review_cycles WHERE name = $1", [name]);
  if (found) return found.id;
  const y = Number(String(name).match(/\d{4}/)?.[0] ?? new Date().getFullYear());
  const h2 = /H2|Q3|Q4/.test(String(name));
  const start = /H1|Q1|Annual/.test(String(name)) ? `${y}-01-01` : h2 ? `${y}-07-01` : `${y}-01-01`;
  const end = /H1/.test(String(name)) ? `${y}-06-30` : `${y}-12-31`;
  return (await h.one<{ id: string }>("INSERT INTO review_cycles (name, type, start_date, end_date) VALUES ($1,$2,$3,$4) RETURNING id", [name, type || "Half-year", start, end]))!.id;
}

// ----------------------------------------------------------------------------- definitions
export const DEFS: Def[] = [
  {
    key: "users", path: "users", table: "users", resource: "users", orderBy: "display_name",
    fields: [f("email"), f("name", "display_name"), en("role", "user_role"), f("employeeId"), b("active", "is_active"), i("failedAttempts"), t("lockedUntil"), t("lastLoginAt"), f("lastLoginIp"), b("mfaEnabled"), f("passwordHash"), t("passwordChangedAt"), created],
  },
  {
    key: "employees", path: "employees", table: "employees", resource: "employees", code: "EMP", orderBy: "code", softDelete: true,
    fields: [
      f("code"), f("firstName"), f("lastName"), f("email", "work_email"), f("personalEmail"), f("phone"), en("gender", "gender"), d("dateOfBirth"), f("nationality"), f("maritalStatus"), f("address"),
      f("departmentId"), f("designationId"), f("teamId"), f("managerId"), f("locationId"), en("employmentType", "employment_type"), en("workMode", "work_mode"), en("status", "employee_status"),
      d("joiningDate"), d("probationEndDate"), d("confirmationDate"), d("lastWorkingDay"), i("noticePeriodDays"), f("emiratesId"), f("passportNumber"), f("laborCardNumber", "labour_card_number"), f("avatarColor"), f("jobRole", "job_role"), created,
    ],
    async load(rows, h) {
      if (!rows.length) return;
      const idList = ids(rows);
      const [ec, bank, skills, sal, shifts] = await Promise.all([
        h.q("SELECT * FROM employee_emergency_contacts WHERE employee_id = ANY($1) ORDER BY is_primary DESC", [idList]),
        h.q("SELECT * FROM employee_bank_accounts WHERE employee_id = ANY($1) ORDER BY is_primary DESC", [idList]),
        h.q("SELECT employee_id, skill FROM employee_skills WHERE employee_id = ANY($1)", [idList]),
        h.q("SELECT * FROM salary_structures WHERE employee_id = ANY($1) AND effective_to IS NULL", [idList]),
        h.q("SELECT DISTINCT ON (employee_id) employee_id, shift_id FROM shift_assignments WHERE employee_id = ANY($1) AND (effective_to IS NULL OR effective_to >= current_date) ORDER BY employee_id, effective_from DESC", [idList]),
      ]);
      const gec = group(ec, "employee_id"), gb = group(bank, "employee_id"), gs = group(skills, "employee_id"), gsal = group(sal, "employee_id"), gsh = group(shifts, "employee_id");
      for (const r of rows) {
        r.name = `${r.firstName} ${r.lastName}`.trim();
        const e = gec.get(r.id)?.[0];
        r.emergencyContact = { name: e?.name ?? "", relation: e?.relation ?? "", phone: e?.phone ?? "" };
        const bk = gb.get(r.id)?.[0];
        r.bank = { name: bk?.bank_name ?? "", iban: bk?.iban ?? "", routingCode: bk?.routing_code ?? "" };
        r.skills = (gs.get(r.id) ?? []).map((x) => x.skill);
        const s = gsal.get(r.id)?.[0];
        r.salary = s ? { basic: s.basic, housing: s.housing, transport: s.transport, medical: s.medical, other: s.other_allowances } : { basic: 0, housing: 0, transport: 0, medical: 0, other: 0 };
        r.shiftId = gsh.get(r.id)?.[0]?.shift_id ?? null;
      }
    },
    async save(id, data, h, existing) {
      if (data.emergencyContact && (data.emergencyContact.name || data.emergencyContact.phone)) {
        await h.q("DELETE FROM employee_emergency_contacts WHERE employee_id=$1", [id]);
        await h.q("INSERT INTO employee_emergency_contacts (employee_id, name, relation, phone) VALUES ($1,$2,$3,$4)", [id, data.emergencyContact.name || "—", data.emergencyContact.relation || null, data.emergencyContact.phone || "—"]);
      }
      if (data.bank && data.bank.iban) {
        await h.q("DELETE FROM employee_bank_accounts WHERE employee_id=$1", [id]);
        await h.q("INSERT INTO employee_bank_accounts (employee_id, bank_name, iban, routing_code) VALUES ($1,$2,$3,$4)", [id, data.bank.name || "—", data.bank.iban, data.bank.routingCode || null]);
      }
      if (Array.isArray(data.skills)) {
        await h.q("DELETE FROM employee_skills WHERE employee_id=$1", [id]);
        for (const s of [...new Set(data.skills.filter(Boolean))]) await h.q("INSERT INTO employee_skills (employee_id, skill) VALUES ($1,$2)", [id, s]);
      }
      if (data.salary) {
        const cur = existing?.salary;
        const s = { basic: 0, housing: 0, transport: 0, medical: 0, other: 0, ...(cur ?? {}), ...data.salary };
        const changed = !cur || ["basic", "housing", "transport", "medical", "other"].some((k) => Number(cur[k] ?? 0) !== Number(s[k] ?? 0));
        if (changed) {
          const from = data.salaryEffectiveFrom ?? (existing ? new Date().toISOString().slice(0, 10) : data.joiningDate ?? new Date().toISOString().slice(0, 10));
          await h.q("DELETE FROM salary_structures WHERE employee_id=$1 AND effective_to IS NULL AND effective_from >= $2", [id, from]);
          await h.q("UPDATE salary_structures SET effective_to = ($2::date - 1) WHERE employee_id=$1 AND effective_to IS NULL", [id, from]);
          await h.q(
            "INSERT INTO salary_structures (employee_id, basic, housing, transport, medical, other_allowances, effective_from, salary_revision_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
            [id, Number(s.basic) || 0, Number(s.housing) || 0, Number(s.transport) || 0, Number(s.medical) || 0, Number(s.other) || 0, from, data.salaryRevisionId ?? null],
          );
        }
      }
      if (data.shiftId !== undefined && data.shiftId !== existing?.shiftId && data.shiftId) {
        const from = existing ? new Date().toISOString().slice(0, 10) : data.joiningDate ?? new Date().toISOString().slice(0, 10);
        await h.q("UPDATE shift_assignments SET effective_to = ($2::date - 1) WHERE employee_id=$1 AND effective_to IS NULL AND effective_from < $2", [id, from]);
        await h.q("DELETE FROM shift_assignments WHERE employee_id=$1 AND effective_to IS NULL", [id]);
        await h.q("INSERT INTO shift_assignments (employee_id, shift_id, effective_from) VALUES ($1,$2,$3)", [id, data.shiftId, from]);
      }
    },
  },
  { key: "departments", path: "departments", table: "departments", resource: "departments", orderBy: "name", fields: [f("name"), f("code"), f("managerId"), f("parentId"), f("locationId"), f("costCenter"), n("budget"), f("description"), created] },
  { key: "designations", path: "designations", table: "designations", resource: "designations", orderBy: "level DESC, title", fields: [f("title"), f("level"), f("departmentId"), n("minSalary"), n("maxSalary"), a("skills", "required_skills"), f("description")] },
  {
    key: "locations", path: "locations", table: "locations", resource: "locations", orderBy: "branch_no NULLS LAST, name",
    fields: [
      i("branchNo"), f("name"), lc("type"), lc("status"), f("city"), f("country"), f("address"), f("timezone"), f("email"), f("phone"), f("mapUrl"),
      f("refNo1", "ref_no_1"), f("refNo2", "ref_no_2"), j("openingHours"), f("managerId"), f("notes"), n("latitude"), n("longitude"), i("geofenceRadiusM"), created,
    ],
  },
  { key: "teams", path: "teams", table: "teams", resource: "departments", orderBy: "name", fields: [f("departmentId"), f("name"), f("leadId")] },
  {
    key: "shifts", path: "shifts", table: "shifts", resource: "shifts", orderBy: "start_time",
    fields: [f("name"), en("type", "shift_type"), tm("start", "start_time"), tm("end", "end_time"), i("breakMinutes"), i("graceMinutes"), { api: "days", col: "working_days", get: (r) => daysLabel(r.working_days), set: (v) => ({ working_days: parseDays(v) }) }, f("color")],
  },
  {
    key: "holidays", path: "holidays", table: "holidays", resource: "holidays", orderBy: "holiday_date",
    fields: [f("name"), d("date", "holiday_date"), en("type", "holiday_type"), f("country"), { api: "locationId", col: "location_id", get: (r) => r.location_id ?? "All", set: (v) => ({ location_id: isUuid(v) ? v : null }) }, f("departmentId"), b("optional", "is_optional"), f("notes")],
  },
  {
    key: "leaveTypes", path: "leave-types", table: "leave_types", resource: "leaveTypes", orderBy: "code",
    fields: [f("name"), f("code"), n("daysPerYear"), b("paid", "is_paid"), f("accrual"), b("carryForward", "allow_carry_forward"), n("maxCarryForward"), b("requiresDocument"), b("allowHalfDay"), en("genderRestriction", "gender"), f("color"), b("active", "is_active")],
  },
  {
    key: "leaves", path: "leaves", table: "leave_requests", resource: "leaves", code: "LV", orderBy: "start_date DESC", approvals: "leave_request",
    fields: [f("code"), f("employeeId"), f("leaveTypeId"), d("from", "start_date"), d("to", "end_date"), n("days"), b("halfDay", "is_half_day"), f("reason"), file("attachment", "attachment_file_id"), en("status", "leave_status"), created],
  },
  {
    key: "attendance", path: "attendance", table: "attendance_records", resource: "attendance", orderBy: "work_date DESC",
    fields: [
      f("employeeId"), d("date", "work_date"),
      { api: "checkIn", col: "check_in_at", get: (r) => dubaiHHMM(r.check_in_at), set: (v, data, ex) => ({ check_in_at: atDubai(data.date ?? ex?.date, v) }) },
      { api: "checkOut", col: "check_out_at", get: (r) => dubaiHHMM(r.check_out_at), set: (v, data, ex) => ({ check_out_at: atDubai(data.date ?? ex?.date, v) }) },
      en("status", "attendance_status"), n("hours", "worked_hours"), n("overtime", "overtime_hours"), f("method"), f("location"), f("ip"), f("notes"),
    ],
  },
  {
    key: "attendanceCorrections", path: "attendance-corrections", table: "attendance_corrections", resource: "attendanceCorrections", orderBy: "created_at DESC",
    fields: [f("employeeId"), d("date", "work_date"), tm("requestedCheckIn"), tm("requestedCheckOut"), f("reason"), en("status", "request_status"), f("reviewedBy"), t("reviewedAt"), created],
  },
  { key: "projects", path: "projects", table: "projects", resource: "timesheets", orderBy: "name", fields: [f("name"), f("code"), f("client"), b("billable", "is_billable"), b("active", "is_active")] },
  {
    key: "timesheets", path: "timesheets", table: "timesheet_entries", resource: "timesheets", orderBy: "work_date DESC",
    fields: [f("employeeId"), d("date", "work_date"), { api: "project", col: "project_id", get: (r) => r.project_id, set: async (v, _d, _e, h) => ({ project_id: await projectId(v, h) }) }, ro(f("projectId")), f("task"), n("hours"), n("overtime", "overtime_hours"), b("billable", "is_billable"), en("status", "timesheet_status"), f("notes"), created],
    async load(rows, h) {
      const p = await h.q("SELECT id, name FROM projects WHERE id = ANY($1)", [[...new Set(rows.map((r) => r.project))]]);
      const m = new Map(p.map((x) => [x.id, x.name]));
      for (const r of rows) r.project = m.get(r.project) ?? r.project;
    },
  },
  {
    key: "documents", path: "documents", table: "documents", resource: "documents", orderBy: "expiry_date NULLS LAST",
    fields: [f("employeeId"), en("category", "document_category"), f("type"), f("number"), d("issueDate"), d("expiryDate"), en("status", "document_status"), i("version", "current_version"), file("fileName", "file_id"), ro(f("fileId")), f("verifiedBy"), t("verifiedAt"), f("uploadedBy"), ro(t("uploadedAt", "created_at")), f("notes")],
  },
  {
    key: "payrollRuns", path: "payroll-runs", table: "payroll_runs", resource: "payrollRuns", orderBy: "period DESC", children: [["payroll_items", "payroll_run_id"]],
    fields: [
      f("month", "period"), en("status", "payroll_status"), i("workingDays"), i("employeeCount"),
      { api: "totals", col: "total_net", get: (r) => ({ gross: r.total_gross, deductions: r.total_deductions, net: r.total_net }), set: (v) => ({ total_gross: v?.gross ?? 0, total_deductions: v?.deductions ?? 0, total_net: v?.net ?? 0 }) },
      f("createdBy"), f("approvedBy"), t("approvedAt"), t("lockedAt"), t("paidAt"), created,
      { api: "locked", col: "locked_at", get: (r) => !!r.locked_at || r.status === "paid", set: (v) => (v ? { locked_at: new Date().toISOString() } : {}) },
    ],
    async load(rows, h) {
      const items = await h.q("SELECT * FROM payroll_items WHERE payroll_run_id = ANY($1)", [ids(rows)]);
      const g = group(items, "payroll_run_id");
      for (const r of rows) {
        r.items = (g.get(r.id) ?? []).map((x) => ({
          employeeId: x.employee_id, basic: x.basic, housing: x.housing, transport: x.transport, medical: x.medical, otherAllowances: x.other_allowances,
          overtimeHours: x.overtime_hours, overtime: x.overtime_amount, bonus: x.bonus, commission: x.commission, unpaidLeaveDeduction: x.unpaid_leave_deduction,
          loanDeduction: x.loan_deduction, otherDeductions: x.other_deductions, gross: x.gross, deductions: x.total_deductions, net: x.net,
          workingDays: x.working_days, paidDays: x.paid_days, absentDays: x.absent_days, unpaidLeaveDays: x.unpaid_leave_days, notes: x.notes, itemId: x.id,
        }));
      }
    },
    async save(id, data, h) {
      if (!Array.isArray(data.items)) return;
      await h.q("DELETE FROM payroll_items WHERE payroll_run_id=$1", [id]);
      for (const x of data.items) {
        await h.q(
          `INSERT INTO payroll_items (payroll_run_id, employee_id, basic, housing, transport, medical, other_allowances, overtime_hours, overtime_amount, bonus, commission,
            unpaid_leave_deduction, loan_deduction, other_deductions, gross, total_deductions, net, working_days, paid_days, absent_days, unpaid_leave_days, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
          [id, x.employeeId, x.basic, x.housing, x.transport, x.medical, x.otherAllowances, x.overtimeHours ?? 0, x.overtime ?? 0, x.bonus ?? 0, x.commission ?? 0, x.unpaidLeaveDeduction ?? 0, x.loanDeduction ?? 0, x.otherDeductions ?? 0, x.gross, x.deductions, x.net, x.workingDays ?? null, x.paidDays ?? null, x.absentDays ?? 0, x.unpaidLeaveDays ?? 0, x.notes ?? null],
        );
      }
    },
  },
  { key: "loans", path: "loans", table: "employee_loans", resource: "loans", orderBy: "start_date DESC", fields: [f("employeeId"), en("type", "loan_type"), n("amount"), n("installment"), n("balance"), d("startDate"), lc("status"), f("reason"), f("approvedBy"), created] },
  {
    key: "salaryRevisions", path: "salary-revisions", table: "salary_revisions", resource: "salaryRevisions", orderBy: "effective_date DESC", approvals: "salary_revision",
    fields: [f("employeeId"), f("type"), f("currentDesignationId"), f("newDesignationId"), n("currentSalary"), n("newSalary"), n("increasePercent"), d("effectiveDate"), f("reason"), en("status", "request_status"), f("createdBy"), created],
  },
  {
    key: "jobs", path: "jobs", table: "job_requisitions", resource: "jobs", code: "JOB", orderBy: "created_at DESC",
    fields: [f("code"), f("title"), f("departmentId"), f("designationId"), f("locationId"), en("employmentType", "employment_type"), i("vacancies"), n("minSalary"), n("maxSalary"), f("experience"), a("skills"), f("description"), f("hiringManagerId"), en("status", "job_status"), d("postedDate"), d("closingDate"), f("createdBy"), created],
  },
  {
    key: "candidates", path: "candidates", table: "candidates", resource: "candidates", code: "CAN", orderBy: "applied_date DESC", children: [["candidate_stage_history", "candidate_id"], ["interviews", "candidate_id"], ["offers", "candidate_id"]],
    fields: [f("code"), f("jobId"), f("name", "full_name"), f("email"), f("phone"), en("stage", "candidate_stage"), f("source"), n("experienceYears"), f("currentCompany"), n("expectedSalary"), f("noticePeriod"), f("education"), a("skills"), a("tags"), i("rating"), f("recruiterId"), file("resume", "resume_file_id"), f("notes"), f("rejectionReason"), d("appliedDate"), f("employeeId")],
  },
  {
    key: "interviews", path: "interviews", table: "interviews", resource: "interviews", orderBy: "scheduled_at",
    fields: [
      f("candidateId"), f("jobId"), f("round"),
      { api: "date", col: "scheduled_at", get: (r) => dubaiDate(r.scheduled_at), set: (v, data, ex) => ({ scheduled_at: atDubai(v, data.time ?? ex?.time ?? "10:00") }) },
      { api: "time", col: "scheduled_at", get: (r) => dubaiHHMM(r.scheduled_at), set: (v, data, ex) => ({ scheduled_at: atDubai(data.date ?? ex?.date, v) }) },
      f("mode"), f("interviewerId"), en("status", "interview_status"), i("score"), f("recommendation"), f("feedback"),
    ],
  },
  {
    key: "offers", path: "offers", table: "offers", resource: "offers", orderBy: "created_at DESC",
    fields: [f("candidateId"), f("jobId"), n("salary"), d("joiningDate"), d("expiryDate"), en("status", "offer_status"), { api: "sentDate", col: "sent_at", get: (r) => dubaiDate(r.sent_at), set: (v) => ({ sent_at: v ? `${String(v).slice(0, 10)}T09:00:00+04:00` : null }) }, f("notes")],
  },
  {
    key: "onboarding", path: "onboarding", table: "onboarding_processes", resource: "onboarding", orderBy: "start_date DESC", children: [["onboarding_tasks", "process_id"]],
    fields: [f("employeeId"), d("startDate"), f("buddyId"), en("stage", "onboarding_stage"), t("completedAt"), created],
    async load(rows, h) {
      const tasks = await h.q("SELECT * FROM onboarding_tasks WHERE process_id = ANY($1) ORDER BY created_at, id", [ids(rows)]);
      const g = group(tasks, "process_id");
      for (const r of rows) r.tasks = (g.get(r.id) ?? []).map((x) => ({ id: x.id, title: x.title, category: x.category, owner: x.owner_role, assigneeId: x.assignee_id, dueDate: x.due_date, done: x.is_done, doneAt: iso(x.done_at) }));
    },
    async save(id, data, h) {
      if (!Array.isArray(data.tasks)) return;
      for (const [k, x] of data.tasks.entries()) {
        if (isUuid(x.id)) await h.q("UPDATE onboarding_tasks SET is_done=$2, done_at = CASE WHEN $2 THEN coalesce(done_at, now()) ELSE NULL END, updated_at=now() WHERE id=$1 AND process_id=$3", [x.id, !!x.done, id]);
        else await h.q("INSERT INTO onboarding_tasks (process_id, title, category, owner_role, due_date, is_done, done_at, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7, now() + ($8 || ' milliseconds')::interval)", [id, x.title, x.category ?? "HR", x.owner ?? null, x.dueDate ?? null, !!x.done, x.done ? new Date().toISOString() : null, k]);
      }
    },
  },
  { key: "onboardingTemplates", path: "onboarding-templates", table: "onboarding_task_templates", resource: "onboarding", orderBy: "sort_order", fields: [f("title"), f("category"), f("owner", "owner_role"), i("dueOffsetDays"), i("sortOrder"), b("active", "is_active")] },
  {
    key: "goals", path: "goals", table: "goals", resource: "goals", orderBy: "due_date NULLS LAST", children: [["key_results", "goal_id"]],
    fields: [f("title"), en("level", "goal_level"), f("ownerId"), f("departmentId"), f("parentGoalId"), f("target"), i("progress"), i("weight"), d("dueDate"), en("status", "goal_status"), created],
    async load(rows, h) {
      const krs = await h.q("SELECT * FROM key_results WHERE goal_id = ANY($1) ORDER BY created_at", [ids(rows)]);
      const g = group(krs, "goal_id");
      for (const r of rows) r.keyResults = (g.get(r.id) ?? []).map((k) => ({ id: k.id, title: k.title, progress: k.progress, targetValue: k.target_value, currentValue: k.current_value }));
    },
    async save(id, data, h) {
      if (!Array.isArray(data.keyResults)) return;
      await h.q("DELETE FROM key_results WHERE goal_id=$1", [id]);
      for (const k of data.keyResults) await h.q("INSERT INTO key_results (goal_id, title, progress, target_value, current_value) VALUES ($1,$2,$3,$4,$5)", [id, k.title, Math.round(Number(k.progress) || 0), k.targetValue ?? null, k.currentValue ?? null]);
    },
  },
  { key: "reviewCycles", path: "review-cycles", table: "review_cycles", resource: "reviews", orderBy: "start_date DESC", fields: [f("name"), f("type"), d("startDate"), d("endDate"), f("status")] },
  {
    key: "reviews", path: "reviews", table: "performance_reviews", resource: "reviews", orderBy: "due_date NULLS LAST",
    fields: [
      f("employeeId"), { api: "cycle", col: "cycle_id", get: (r) => r.cycle_id, set: async (v, data, _e, h) => ({ cycle_id: await cycleId(v, data.type, h) }) }, ro(f("cycleId")),
      f("reviewerId"), d("dueDate"), n("selfScore"), n("managerScore"), n("finalRating"), en("status", "review_status"), f("strengths"), f("improvements"), b("promotionRecommended"),
    ],
    async load(rows, h) {
      const c = await h.q("SELECT id, name, type FROM review_cycles WHERE id = ANY($1)", [[...new Set(rows.map((r) => r.cycleId))]]);
      const m = new Map(c.map((x) => [x.id, x]));
      for (const r of rows) {
        r.cycle = m.get(r.cycleId)?.name ?? r.cycle;
        r.type = m.get(r.cycleId)?.type ?? null;
      }
    },
  },
  { key: "kpis", path: "kpis", table: "kpis", resource: "kpis", orderBy: "period DESC", fields: [f("employeeId"), f("name"), f("period"), i("weight"), n("target"), n("actual"), n("achievement"), i("selfRating"), i("managerRating")] },
  {
    key: "expenses", path: "expenses", table: "expense_claims", resource: "expenses", code: "EXP", orderBy: "expense_date DESC", approvals: "expense_claim",
    fields: [f("code"), f("employeeId"), f("category"), n("amount"), f("currency"), d("date", "expense_date"), f("description"), file("receipt", "receipt_file_id"), f("projectId"), en("status", "expense_status"), t("reimbursedAt"), created],
  },
  {
    key: "assets", path: "assets", table: "assets", resource: "assets", code: "AST", orderBy: "code", children: [["asset_assignments", "asset_id"], ["asset_maintenance", "asset_id"]],
    fields: [f("code"), f("name"), f("type"), f("serialNumber"), d("purchaseDate"), n("cost"), d("warrantyExpiry"), en("status", "asset_status"), f("condition"), f("locationId"), f("assignedTo", "current_assignee_id"), f("notes")],
    async load(rows, h) {
      const [asg, mnt] = await Promise.all([
        h.q("SELECT * FROM asset_assignments WHERE asset_id = ANY($1) AND returned_on IS NULL", [ids(rows)]),
        h.q("SELECT * FROM asset_maintenance WHERE asset_id = ANY($1) ORDER BY date DESC", [ids(rows)]),
      ]);
      const ga = group(asg, "asset_id"), gm = group(mnt, "asset_id");
      for (const r of rows) {
        r.assignedDate = ga.get(r.id)?.[0]?.assigned_on ?? null;
        r.maintenanceHistory = (gm.get(r.id) ?? []).map((m) => ({ date: m.date, note: m.description, cost: m.cost, vendor: m.vendor }));
      }
    },
    async save(id, data, h, existing) {
      if (data.assignedTo !== undefined && data.assignedTo !== existing?.assignedTo) {
        await h.q("UPDATE asset_assignments SET returned_on = current_date, updated_at = now() WHERE asset_id=$1 AND returned_on IS NULL", [id]);
        if (data.assignedTo) await h.q("INSERT INTO asset_assignments (asset_id, employee_id, assigned_on) VALUES ($1,$2,$3)", [id, data.assignedTo, data.assignedDate || new Date().toISOString().slice(0, 10)]);
      }
      if (Array.isArray(data.maintenanceHistory)) {
        const count = Number((await h.one<{ c: number }>("SELECT count(*)::int c FROM asset_maintenance WHERE asset_id=$1", [id]))?.c ?? 0);
        for (const m of data.maintenanceHistory.slice(count)) await h.q("INSERT INTO asset_maintenance (asset_id, date, description, cost, vendor) VALUES ($1,$2,$3,$4,$5)", [id, m.date, m.note ?? m.description, m.cost ?? null, m.vendor ?? null]);
      }
    },
  },
  {
    key: "trainings", path: "trainings", table: "training_programs", resource: "trainings", orderBy: "start_date", children: [["training_enrollments", "program_id"]],
    fields: [f("title"), f("category"), f("trainer"), d("startDate"), d("endDate"), f("mode"), i("seats"), n("budget"), lc("status"), b("certification", "awards_certificate"), f("description")],
    async load(rows, h) {
      const en2 = await h.q("SELECT program_id, employee_id FROM training_enrollments WHERE program_id = ANY($1)", [ids(rows)]);
      const g = group(en2, "program_id");
      for (const r of rows) r.enrolled = (g.get(r.id) ?? []).map((x) => x.employee_id);
    },
    async save(id, data, h) {
      if (!Array.isArray(data.enrolled)) return;
      await h.q("DELETE FROM training_enrollments WHERE program_id=$1 AND NOT (employee_id = ANY($2))", [id, data.enrolled]);
      for (const e of data.enrolled) await h.q("INSERT INTO training_enrollments (program_id, employee_id) VALUES ($1,$2) ON CONFLICT (program_id, employee_id) DO NOTHING", [id, e]);
    },
  },
  {
    key: "tickets", path: "tickets", table: "tickets", resource: "tickets", code: "TKT", orderBy: "created_at DESC", children: [["ticket_comments", "ticket_id"]],
    fields: [f("code"), f("employeeId"), f("category"), f("subject"), f("description"), en("priority", "priority"), en("status", "ticket_status"), f("assignedTo"), i("slaHours"), t("dueAt"), f("resolution"), t("resolvedAt"), created, updated],
    async load(rows, h) {
      const cs = await h.q("SELECT c.*, u.employee_id, u.display_name FROM ticket_comments c JOIN users u ON u.id = c.author_user_id WHERE c.ticket_id = ANY($1) ORDER BY c.created_at", [ids(rows)]);
      const g = group(cs, "ticket_id");
      for (const r of rows) r.comments = (g.get(r.id) ?? []).map((c) => ({ id: c.id, by: c.employee_id, userId: c.author_user_id, userName: c.display_name, at: iso(c.created_at), text: c.body, internal: c.is_internal }));
    },
    async save(id, data, h) {
      if (!Array.isArray(data.comments)) return;
      const count = Number((await h.one<{ c: number }>("SELECT count(*)::int c FROM ticket_comments WHERE ticket_id=$1", [id]))?.c ?? 0);
      for (const c of data.comments.slice(count)) {
        const uid = c.userId ?? (await h.userIdForEmployee(c.by));
        if (uid) await h.q("INSERT INTO ticket_comments (ticket_id, author_user_id, body, is_internal, created_at) VALUES ($1,$2,$3,$4,$5)", [id, uid, c.text, !!c.internal, c.at ?? new Date().toISOString()]);
      }
    },
  },
  { key: "announcements", path: "announcements", table: "announcements", resource: "announcements", orderBy: "is_pinned DESC, publish_at DESC", fields: [f("title"), f("body"), f("category"), lc("priority"), f("audience"), b("pinned", "is_pinned"), f("authorId"), t("publishAt"), t("expiresAt"), created] },
  {
    key: "offboarding", path: "exits", table: "exits", resource: "offboarding", orderBy: "created_at DESC", children: [["exit_checklist_items", "exit_id"]],
    fields: [
      f("employeeId"), d("resignationDate"), d("lastWorkingDay"), f("reason"), f("comments"), en("stage", "exit_stage"), t("completedAt"), created,
      { api: "exitInterview", col: "exit_interview_rating", get: (r) => (r.exit_interview_rating || r.exit_interview_feedback ? { rating: r.exit_interview_rating, feedback: r.exit_interview_feedback } : null), set: (v) => ({ exit_interview_rating: v?.rating ?? null, exit_interview_feedback: v?.feedback ?? null }) },
    ],
    async load(rows, h) {
      const cl = await h.q("SELECT * FROM exit_checklist_items WHERE exit_id = ANY($1) ORDER BY sort_order", [ids(rows)]);
      const g = group(cl, "exit_id");
      for (const r of rows) r.checklist = (g.get(r.id) ?? []).map((c) => ({ id: c.id, title: c.title, done: c.is_done, owner: c.owner_role }));
    },
    async save(id, data, h) {
      if (!Array.isArray(data.checklist)) return;
      for (const [k, c] of data.checklist.entries()) {
        if (isUuid(c.id)) await h.q("UPDATE exit_checklist_items SET is_done=$2, done_at = CASE WHEN $2 THEN coalesce(done_at, now()) ELSE NULL END, updated_at = now() WHERE id=$1", [c.id, !!c.done]);
        else await h.q("INSERT INTO exit_checklist_items (exit_id, title, is_done, sort_order, owner_role) VALUES ($1,$2,$3,$4,$5)", [id, c.title, !!c.done, k, c.owner ?? null]);
      }
    },
  },
  {
    key: "settlements", path: "settlements", table: "final_settlements", resource: "settlements", orderBy: "created_at DESC", children: [["final_settlement_lines", "settlement_id"]],
    fields: [f("employeeId"), f("exitId"), d("joiningDate"), d("lastWorkingDay"), f("reason", "separation_type"), n("serviceYears"), n("grossAmount"), n("totalDeductions"), n("netAmount"), en("status", "settlement_status"), f("approvedBy"), t("paidAt"), f("createdBy"), created],
    async load(rows, h) {
      const ls = await h.q("SELECT * FROM final_settlement_lines WHERE settlement_id = ANY($1) ORDER BY created_at", [ids(rows)]);
      const g = group(ls, "settlement_id");
      for (const r of rows) {
        const l = g.get(r.id) ?? [];
        r.additions = l.filter((x) => x.kind === "addition").map((x) => ({ label: x.label, amount: x.amount, note: x.note ?? undefined }));
        r.deductions = l.filter((x) => x.kind === "deduction").map((x) => ({ label: x.label, amount: x.amount, note: x.note ?? undefined }));
      }
    },
    async save(id, data, h) {
      if (!Array.isArray(data.additions) && !Array.isArray(data.deductions)) return;
      await h.q("DELETE FROM final_settlement_lines WHERE settlement_id=$1", [id]);
      for (const [kind, list] of [["addition", data.additions ?? []], ["deduction", data.deductions ?? []]] as const) {
        for (const l of list) await h.q("INSERT INTO final_settlement_lines (settlement_id, kind, label, amount, note) VALUES ($1,$2,$3,$4,$5)", [id, kind, l.label, l.amount, l.note ?? null]);
      }
    },
  },
  {
    key: "cases", path: "cases", table: "er_cases", resource: "cases", code: "CASE", orderBy: "created_at DESC", children: [["er_case_notes", "case_id"]],
    fields: [f("code"), f("employeeId"), f("type"), en("priority", "priority"), f("description"), f("assignedTo"), lc("status"), b("confidential", "is_confidential"), f("resolution"), created],
    async load(rows, h) {
      const ns = await h.q("SELECT n.*, u.employee_id, u.display_name FROM er_case_notes n JOIN users u ON u.id = n.author_user_id WHERE n.case_id = ANY($1) ORDER BY n.created_at", [ids(rows)]);
      const g = group(ns, "case_id");
      for (const r of rows) r.notes = (g.get(r.id) ?? []).map((x) => ({ by: x.employee_id, userName: x.display_name, at: iso(x.created_at), text: x.body }));
    },
  },
  { key: "recognitions", path: "recognitions", table: "recognitions", resource: "recognitions", orderBy: "award_date DESC", fields: [f("employeeId"), f("award"), f("reason"), i("points"), f("givenBy"), d("date", "award_date")] },
  {
    key: "surveys", path: "surveys", table: "surveys", resource: "surveys", orderBy: "start_date DESC", children: [["survey_responses", "survey_id"]],
    fields: [f("title"), f("type"), b("anonymous", "is_anonymous"), lc("status"), d("startDate"), d("endDate"), j("questions"), n("engagementScore")],
    async load(rows, h) {
      const c = await h.q("SELECT survey_id, count(*)::int c FROM survey_responses WHERE survey_id = ANY($1) GROUP BY survey_id", [ids(rows)]);
      const m = new Map(c.map((x) => [x.survey_id, x.c]));
      for (const r of rows) r.responses = m.get(r.id) ?? r.responsesSeed ?? 0;
    },
  },
  {
    key: "notifications", path: "notifications-admin", table: "notifications", resource: "users", orderBy: "created_at DESC", children: [["notification_reads", "notification_id"]],
    fields: [f("userId"), f("role", "role_group"), f("title"), f("message"), f("link"), b("read", "is_read"), created],
  },
  {
    key: "auditLogs", path: "audit-logs", table: "audit_logs", resource: "auditLogs", orderBy: "created_at DESC",
    fields: [f("userId"), f("userName"), en("role", "user_role"), f("action"), f("entity"), f("entityId"), j("details", "changes"), f("ip"), f("userAgent"), created],
  },
  { key: "integrations", path: "integrations", table: "integrations", resource: "settings", orderBy: "provider", fields: [f("provider"), b("enabled", "is_enabled"), j("config"), t("lastSyncAt")] },
];

export const DEF_BY_KEY = new Map(DEFS.map((x) => [x.key, x]));
export const DEF_BY_PATH = new Map(DEFS.map((x) => [x.path, x]));
export { isUuid };
