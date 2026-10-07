import { Injectable } from "@nestjs/common";
import bcrypt from "bcryptjs";
import { config } from "../config.js";
import { DbService } from "../database/db.service.js";
import { Repo } from "./repository.service.js";
import { AccessService, HttpError, OWNER_FIELD, SELF_EDITABLE, type Session } from "./access.service.js";
import type { Row } from "./resources.js";
import { roleKey, type Resource } from "./rbac.js";
import { leaveBalances, payrollTotals, recomputeItem, salaryTotal, workingDays, type LeaveLite, type LeaveTypeLite, type PayrollItem, type Salary } from "./hr.js";

type Data = Record<string, any>;
const now = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);

export const EXIT_CHECKLIST = ["Manager approval", "HR review", "Knowledge transfer", "Asset return", "Access removal", "Exit interview", "Final settlement", "Experience certificate", "Clearance certificate"];

function required(data: Data, fields: string[]) {
  const missing = fields.filter((f) => data[f] === undefined || data[f] === null || data[f] === "");
  if (missing.length) throw new HttpError(400, `Missing required field(s): ${missing.join(", ")}`);
}

/** Validation, defaults and side effects for the generic CRUD endpoints. */
@Injectable()
export class HooksService {
  constructor(private readonly db: DbService, private readonly repo: Repo, private readonly access: AccessService) {}

  async holidays() {
    return (await this.db.query<{ d: string }>("SELECT holiday_date::text d FROM holidays")).map((r) => r.d);
  }

  async onboardingTasks(start: string) {
    const tpl = await this.db.query<{ title: string; category: string; owner_role: string; due_offset_days: number }>("SELECT * FROM onboarding_task_templates WHERE is_active ORDER BY sort_order");
    return tpl.map((t, i) => {
      const due = new Date(`${start}T00:00:00Z`);
      due.setUTCDate(due.getUTCDate() + Number(t.due_offset_days ?? 0));
      return { id: `new-${i}`, title: t.title, category: t.category, owner: t.owner_role, done: false, dueDate: due.toISOString().slice(0, 10) };
    });
  }

  /** Normalises and checks an employee ID such as "medx324" → "MEDX324". */
  async validEmployeeCode(raw: string, ignoreId?: string) {
    const code = raw.trim().toUpperCase().replace(/\s+/g, "");
    if (!/^[A-Z][A-Z0-9-]{1,15}[0-9]$/.test(code)) throw new HttpError(400, `Employee ID "${raw}" is not valid. Use letters followed by numbers, e.g. MEDX324.`);
    const clash = await this.db.one<{ id: string; name: string }>("SELECT id, first_name || ' ' || last_name AS name FROM employees WHERE upper(code) = $1 AND id <> coalesce($2::uuid, '00000000-0000-0000-0000-000000000000')", [code, ignoreId ?? null]);
    if (clash) throw new HttpError(409, `Employee ID ${code} is already used by ${clash.name}`);
    return code;
  }

  async beforeCreate(key: string, resource: Resource, input: Data, s: Session): Promise<Data> {
    const data: Data = { ...input };
    delete data.id;
    // HR may set an employee ID explicitly (e.g. MEDX324); everything else gets an auto-generated code
    const customCode = key === "employees" && this.access.can(s.role, "employees", "create") && typeof data.code === "string" && data.code.trim() ? await this.validEmployeeCode(data.code) : null;
    delete data.code;
    if (customCode) data.code = customCode;
    const owner = OWNER_FIELD[key];
    const scope = this.access.scopeOf(s.role, resource);
    if (owner && owner !== "id") {
      const unownedAllowed = key === "assets" || (key === "documents" && data.category === "Company");
      if (scope === "own") data[owner] = s.employeeId;
      else if (data[owner] === undefined || data[owner] === "") data[owner] = unownedAllowed ? null : s.employeeId;
      if (!(unownedAllowed && data[owner] == null) && !(await this.access.scopePredicate(s, resource))(data[owner])) {
        throw new HttpError(403, "You can only create records for employees in your scope");
      }
    }

    switch (key) {
      case "employees": {
        required(data, ["firstName", "lastName", "email", "departmentId", "designationId", "joiningDate"]);
        if ((await this.repo.find("employees", { email: data.email })).length) throw new HttpError(409, "An employee with this email already exists");
        const probation = new Date(String(data.joiningDate));
        probation.setMonth(probation.getMonth() + 6);
        const sal = (data.salary as Partial<Salary>) ?? {};
        if (!this.access.can(s.role, "compensation", "edit") && !this.access.can(s.role, "employees", "create")) delete data.salary;
        if (data.role !== undefined && data.role !== "" && !roleKey(data.role)) throw new HttpError(400, `Unknown role "${data.role}"`);
        delete data.createLogin; delete data.loginRole; delete data.initialPassword; delete data.loginUsername; delete data.role;
        return {
          ...data,
          status: data.status || "Probation",
          employmentType: data.employmentType || "Full-time",
          workMode: data.workMode || "Office",
          probationEndDate: data.probationEndDate || probation.toISOString().slice(0, 10),
          salary: { basic: Number(sal.basic ?? 0), housing: Number(sal.housing ?? 0), transport: Number(sal.transport ?? 0), medical: Number(sal.medical ?? 0), other: Number(sal.other ?? 0) },
          avatarColor: data.avatarColor ?? ["#6366f1", "#ec4899", "#14b8a6", "#f97316", "#0ea5e9"][Math.floor(Math.random() * 5)],
          noticePeriodDays: data.noticePeriodDays ?? 30,
        };
      }
      case "users": {
        required(data, ["email", "role", "password"]);
        if ((await this.repo.find("users", { email: String(data.email).toLowerCase() })).length) throw new HttpError(409, "A user with this email already exists");
        if (String(data.password).length < 8) throw new HttpError(400, "Password must be at least 8 characters");
        if (data.role === "super_admin" && s.role !== "super_admin") throw new HttpError(403, "Only a Super Admin can create Super Admins");
        const emp = data.employeeId ? await this.repo.get("employees", data.employeeId) : undefined;
        if (emp && (await this.repo.find("users", { employeeId: emp.id })).length) throw new HttpError(409, `${emp.name} already has a login`);
        // Employee accounts sign in with their employee code; other accounts with the part of the email before @
        const username = await this.validUsername(data.username || emp?.code || String(data.email).split("@")[0]);
        const out: Data = { ...data, username, userType: emp ? "Employee" : data.userType || "Other", email: String(data.email).toLowerCase(), passwordHash: bcrypt.hashSync(String(data.password), 10), name: data.name || emp?.name || data.email, active: data.active ?? true };
        delete out.password;
        return out;
      }
      case "leaves": {
        required(data, ["leaveTypeId", "from", "to", "reason"]);
        if (String(data.to) < String(data.from)) throw new HttpError(400, "End date must be after start date");
        const days = data.halfDay ? 0.5 : workingDays(String(data.from), String(data.to), await this.holidays());
        if (days <= 0) throw new HttpError(400, "Selected range has no working days");
        const overlap = (await this.repo.find("leaves", { employeeId: data.employeeId, status: ["Pending", "Manager Approved", "Approved"] })).filter((l) => String(l.from) <= String(data.to) && String(l.to) >= String(data.from));
        if (overlap.length) throw new HttpError(409, `Overlaps with existing leave ${overlap[0].code}`);
        const emp = await this.repo.get("employees", data.employeeId);
        const type = await this.repo.get("leaveTypes", data.leaveTypeId);
        if (!type) throw new HttpError(400, "Unknown leave type");
        if (emp) {
          const bal = leaveBalances(emp as never, [type as unknown as LeaveTypeLite], (await this.repo.find("leaves", { employeeId: emp.id })) as unknown as LeaveLite[])[0];
          const settings = await this.access.settings<{ leave?: { allowNegativeBalance?: boolean } }>();
          if (bal.available < days && !settings.leave?.allowNegativeBalance) throw new HttpError(409, `Insufficient ${type.name} balance (${bal.available} day(s) available)`);
        }
        if (emp?.managerId) await this.access.notify({ employeeId: emp.managerId }, "Leave request pending", `${emp.name} requested ${days} day(s) of ${type.name}.`, "/leave");
        return { ...data, days, halfDay: !!data.halfDay, status: "Pending", approvals: [] };
      }
      case "expenses": {
        required(data, ["category", "amount", "date", "description"]);
        if (Number(data.amount) <= 0) throw new HttpError(400, "Amount must be positive");
        const emp = await this.repo.get("employees", data.employeeId);
        if (emp?.managerId) await this.access.notify({ employeeId: emp.managerId }, "Expense claim pending", `${emp.name} submitted AED ${data.amount} (${data.category}).`, "/expenses");
        return { ...data, amount: Number(data.amount), currency: "AED", status: "Pending", approvals: [], receipt: data.receipt || null };
      }
      case "tickets": {
        required(data, ["category", "subject", "description"]);
        await this.access.notify({ role: "hr" }, "New HR ticket", `${await this.access.employeeName(data.employeeId)}: ${data.subject}`, "/helpdesk");
        const sla = data.priority === "Urgent" ? 8 : data.priority === "High" ? 24 : 48;
        return { ...data, priority: data.priority || "Medium", status: "Open", assignedTo: data.assignedTo || null, slaHours: sla, dueAt: new Date(Date.now() + sla * 3600000).toISOString(), comments: [] };
      }
      case "attendanceCorrections":
        required(data, ["date", "requestedCheckIn", "requestedCheckOut", "reason"]);
        return { ...data, status: "Pending" };
      case "timesheets":
        required(data, ["date", "project", "hours"]);
        return { ...data, hours: Number(data.hours), overtime: Math.max(0, Number(data.hours) - 8), billable: data.billable ?? true, status: "Submitted" };
      case "salaryRevisions": {
        required(data, ["employeeId", "newSalary", "effectiveDate", "reason"]);
        const emp = await this.repo.get("employees", data.employeeId);
        if (!emp) throw new HttpError(404, "Employee not found");
        const current = salaryTotal(emp.salary as Salary);
        const next = Number(data.newSalary);
        return { ...data, type: data.type || (data.newDesignationId && data.newDesignationId !== emp.designationId ? "Promotion" : "Salary Revision"), currentDesignationId: emp.designationId, newDesignationId: data.newDesignationId || emp.designationId, currentSalary: current, newSalary: next, increasePercent: Math.round(((next - current) / (current || 1)) * 1000) / 10, status: "Pending", approvals: [], createdBy: s.userId };
      }
      case "offboarding": {
        required(data, ["lastWorkingDay", "reason"]);
        if ((await this.repo.find("offboarding", { employeeId: data.employeeId })).some((o) => !["Completed", "Withdrawn"].includes(o.stage))) throw new HttpError(409, "An active resignation already exists");
        const emp = await this.repo.get("employees", data.employeeId);
        if (emp?.managerId) await this.access.notify({ employeeId: emp.managerId }, "Resignation submitted", `${emp.name} submitted a resignation.`, "/offboarding");
        return { ...data, resignationDate: data.resignationDate || today(), stage: "Submitted", checklist: EXIT_CHECKLIST.map((t, i) => ({ id: `new-${i}`, title: t, done: false })) };
      }
      case "jobs":
        required(data, ["title", "departmentId", "vacancies"]);
        return { ...data, employmentType: data.employmentType || "Full-time", status: this.access.can(s.role, "jobs", "approve") ? data.status || "Open" : "Pending Approval", hiringManagerId: data.hiringManagerId || s.employeeId, postedDate: today(), skills: data.skills ?? [], createdBy: s.userId };
      case "candidates":
        required(data, ["name", "email", "jobId"]);
        return { ...data, stage: data.stage || "Applied", appliedDate: today(), tags: data.tags ?? [], skills: data.skills ?? [], rating: Number(data.rating ?? 3), rejectionReason: "" };
      case "interviews": {
        required(data, ["candidateId", "date", "time", "interviewerId"]);
        await this.access.notify({ employeeId: data.interviewerId }, "Interview scheduled", `You're interviewing on ${data.date} at ${data.time}.`, "/recruitment/interviews");
        return { ...data, round: data.round || "First Interview", mode: data.mode || "Video Call", jobId: data.jobId || (await this.repo.get("candidates", data.candidateId))?.jobId, status: data.status || "Scheduled", score: data.score ?? null };
      }
      case "offers":
        required(data, ["candidateId", "salary", "joiningDate"]);
        return { ...data, jobId: data.jobId || (await this.repo.get("candidates", data.candidateId))?.jobId, status: "Draft", sentDate: null };
      case "documents":
        required(data, ["category", "type"]);
        return { ...data, version: 1, status: this.access.can(s.role, "documents", "approve") ? data.status || "Verified" : "Pending Verification", uploadedBy: s.userId, fileName: data.fileName || `${String(data.type).toLowerCase().replace(/\s+/g, "-")}.pdf` };
      case "announcements":
        required(data, ["title", "body"]);
        await this.access.notify({ role: "all" }, `📣 ${data.title}`, String(data.body).slice(0, 140), "/announcements");
        return { ...data, category: data.category || "Company", priority: data.priority || "Normal", authorId: s.employeeId, pinned: !!data.pinned, audience: data.audience || "All", publishAt: now() };
      case "goals":
        required(data, ["title", "level"]);
        return { ...data, progress: Number(data.progress ?? 0), weight: Number(data.weight ?? 10), keyResults: data.keyResults ?? [], status: data.status || "In Progress" };
      case "recognitions":
        required(data, ["employeeId", "award", "reason"]);
        await this.access.notify({ employeeId: data.employeeId }, `🏆 ${data.award}`, String(data.reason ?? "Congratulations!"), "/engagement");
        return { ...data, givenBy: s.employeeId, date: data.date || today(), points: Number(data.points ?? 100) };
      case "cases":
        required(data, ["employeeId", "type", "description"]);
        return { ...data, priority: data.priority || "Medium", status: "Open", confidential: !!data.confidential, resolution: "" };
      case "kpis":
        required(data, ["employeeId", "name", "target"]);
        return { ...data, period: data.period || "Current", achievement: Math.round((Number(data.actual ?? 0) / Number(data.target || 1)) * 100) };
      case "onboarding": {
        required(data, ["employeeId"]);
        if ((await this.repo.find("onboarding", { employeeId: data.employeeId })).length) throw new HttpError(409, "Onboarding already exists for this employee");
        const emp = await this.repo.get("employees", data.employeeId);
        const start = String(data.startDate || emp?.joiningDate || today());
        return { ...data, startDate: start, buddyId: data.buddyId || emp?.managerId || null, stage: "Offer Accepted", tasks: await this.onboardingTasks(start) };
      }
      case "settlements":
        required(data, ["employeeId", "lastWorkingDay"]);
        return { ...data, status: "Draft", createdBy: s.userId };
      case "loans":
        required(data, ["employeeId", "type", "amount", "installment"]);
        return { ...data, balance: data.balance ?? data.amount, status: data.status || "Active", startDate: data.startDate || today(), approvedBy: s.userId };
      case "reviews":
        required(data, ["employeeId", "cycle"]);
        return { ...data, reviewerId: data.reviewerId || (await this.repo.get("employees", data.employeeId))?.managerId || s.employeeId, status: "Self Review" };
      case "holidays":
        required(data, ["name", "date", "type"]);
        return { ...data, country: data.country || "UAE" };
      default:
        return data;
    }
  }

  async afterCreate(key: string, row: Row, input: Data, s: Session) {
    if (key !== "employees") return;
    if (input.createLogin && !(await this.repo.find("users", { email: String(row.email).toLowerCase() })).length) {
      const role = roleKey(input.role ?? input.loginRole) ?? "developer";
      const password = String(input.initialPassword || config.defaultUserPassword);
      if (!password) throw new HttpError(400, "Enter an initial password for the login");
      await this.repo.insert("users", { username: await this.validUsername(String(input.loginUsername || row.code)), userType: "Employee", email: String(row.email).toLowerCase(), name: row.name, role, employeeId: row.id, passwordHash: bcrypt.hashSync(password, 10), active: true });
    }
    await this.access.notify({ role: "hr" }, "New employee added", `${row.name} (${row.code}) joins on ${row.joiningDate}.`, `/employees/${row.id}`);
  }

  async beforeUpdate(key: string, resource: Resource, record: Row, input: Data, s: Session): Promise<Data> {
    let patch: Data = { ...input };
    const newCode = key === "employees" && typeof patch.code === "string" && patch.code.trim() && patch.code.trim().toUpperCase() !== String(record.code).toUpperCase() && this.access.can(s.role, "employees", "create") ? await this.validEmployeeCode(patch.code, record.id) : null;
    for (const k of ["id", "code", "createdAt", "updatedAt", "approvals"]) delete patch[k];
    if (newCode) {
      patch.code = newCode;
      // Logins that use the old employee code as username follow the new code
      await this.db.query("UPDATE users SET username=$1 WHERE employee_id=$2 AND username=$3", [newCode, record.id, record.code]);
    }
    const owner = OWNER_FIELD[key];
    const scope = this.access.scopeOf(s.role, resource);
    const isOwn = owner ? record[owner] === s.employeeId : false;
    if (scope === "own" || (isOwn && key === "employees" && !this.access.can(s.role, "employees", "create"))) {
      const allowed = SELF_EDITABLE[key];
      if (!allowed) throw new HttpError(403, "You can't edit this record");
      patch = Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.includes(k)));
    }
    if (["leaves", "expenses", "attendanceCorrections", "salaryRevisions", "payrollRuns", "settlements"].includes(key)) delete patch.status;

    switch (key) {
      case "leaves":
        if (record.status !== "Pending") throw new HttpError(409, "Only pending leave requests can be edited");
        if (patch.from || patch.to || patch.halfDay !== undefined) {
          const from = String(patch.from ?? record.from), to = String(patch.to ?? record.to);
          patch.days = (patch.halfDay ?? record.halfDay) ? 0.5 : workingDays(from, to, await this.holidays());
        }
        break;
      case "timesheets":
        if (record.status === "Approved" && scope !== "all") throw new HttpError(409, "Approved timesheets are locked");
        if (patch.hours !== undefined) patch.overtime = Math.max(0, Number(patch.hours) - 8);
        break;
      case "employees": {
        if (patch.salary && !this.access.can(s.role, "compensation", "edit")) throw new HttpError(403, "You can't change compensation");
        delete patch.name;
        // Role is stored on the employee's login, not the employee row
        const role = patch.role === undefined ? undefined : roleKey(patch.role);
        delete patch.role; delete patch.username;
        if (role) {
          const login = (await this.repo.find("users", { employeeId: record.id }))[0];
          if (login && login.role !== role) {
            if (!this.access.can(s.role, "users", "edit")) throw new HttpError(403, "Only an Admin can change roles");
            if (login.id === s.userId) throw new HttpError(409, "You can't change your own role");
            await this.db.query("UPDATE users SET role=$1 WHERE id=$2", [role, login.id]);
            await this.access.audit(s, "Role Changed", "users", login.id, { from: login.role, to: role });
          }
        }
        break;
      }
      case "users":
        delete patch.passwordHash;
        if (typeof patch.username === "string" && patch.username.trim().toLowerCase() !== String(record.username).toLowerCase()) patch.username = await this.validUsername(patch.username, record.id);
        else delete patch.username;
        if (patch.employeeId !== undefined) patch.userType = patch.employeeId ? "Employee" : patch.userType ?? record.userType;
        if (patch.password) {
          if (String(patch.password).length < 8) throw new HttpError(400, "Password must be at least 8 characters");
          patch.passwordHash = bcrypt.hashSync(String(patch.password), 10);
          delete patch.password;
        }
        if (record.id === s.userId && patch.role && patch.role !== record.role) throw new HttpError(409, "You can't change your own role");
        if (patch.role === "super_admin" && s.role !== "super_admin") throw new HttpError(403, "Only a Super Admin can grant Super Admin");
        break;
      case "payrollRuns":
        if (record.locked || record.status !== "Draft") throw new HttpError(409, "Only draft payroll can be adjusted");
        if (patch.items) {
          const items = (patch.items as PayrollItem[]).map(recomputeItem);
          patch = { items, totals: payrollTotals(items), employeeCount: items.length };
        }
        break;
      case "kpis":
        if (patch.actual !== undefined || patch.target !== undefined) patch.achievement = Math.round((Number(patch.actual ?? record.actual) / Number(patch.target ?? record.target ?? 1)) * 100);
        break;
      case "reviews": {
        const self = Number(patch.selfScore ?? record.selfScore), mgr = Number(patch.managerScore ?? record.managerScore);
        if (patch.selfScore != null && ["Self Review", "Not Started"].includes(record.status)) patch.status = "Manager Review";
        if (patch.managerScore != null && self && mgr) {
          patch.finalRating = Math.round(((self + mgr * 2) / 3) * 10) / 10;
          patch.status = "Completed";
        }
        break;
      }
      case "onboarding": {
        const tasks = (patch.tasks ?? record.tasks) as { done: boolean }[];
        const ratio = tasks.filter((t) => t.done).length / (tasks.length || 1);
        const stages = ["Offer Accepted", "Documents Collection", "HR Verification", "IT Setup", "Manager Setup", "Employee Joining", "Onboarding Complete"];
        patch.stage = stages[Math.min(6, Math.floor(ratio * 6))];
        if (ratio === 1) patch.completedAt = now();
        break;
      }
      case "goals":
        if (patch.progress !== undefined) {
          patch.progress = Math.max(0, Math.min(100, Number(patch.progress)));
          if (patch.progress === 100) patch.status = "Completed";
        }
        break;
      case "documents":
        if (patch.fileName && patch.fileName !== record.fileName) {
          patch.version = Number(record.version ?? 1) + 1;
          patch.uploadedBy = s.userId;
        } else delete patch.version;
        break;
      case "tickets":
        if (patch.status && ["Resolved", "Closed"].includes(patch.status) && !record.resolvedAt) patch.resolvedAt = now();
        break;
    }
    return patch;
  }

  /** Trimmed username that no other account uses: letters, digits, dot, dash and underscore. */
  private async validUsername(value: unknown, exceptUserId?: string) {
    const u = String(value ?? "").trim();
    if (!/^[A-Za-z0-9._-]{3,50}$/.test(u)) throw new HttpError(400, "Username must be 3-50 characters: letters, numbers, dot, dash or underscore");
    const taken = await this.db.one<{ id: string }>("SELECT id FROM users WHERE username=$1 AND id <> COALESCE($2::uuid, '00000000-0000-0000-0000-000000000000')", [u, exceptUserId ?? null]);
    if (taken) throw new HttpError(409, `Username "${u}" is already taken`);
    return u;
  }

  async beforeDelete(key: string, record: Row, s: Session) {
    if (key === "users" && record.id === s.userId) throw new HttpError(409, "You can't delete your own account");
    if (key === "payrollRuns" && record.status !== "Draft") throw new HttpError(409, "Only draft payroll runs can be deleted");
    if (key === "employees" && (await this.repo.find("employees", { managerId: record.id })).length) throw new HttpError(409, "Reassign this employee's direct reports first");
  }
}
