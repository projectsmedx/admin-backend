import { Injectable } from "@nestjs/common";
import bcrypt from "bcryptjs";
import { config } from "../config.js";
import { DbService } from "../database/db.service.js";
import { Repo } from "./repository.service.js";
import { AccessService, HttpError, type Session } from "./access.service.js";
import { HooksService } from "./hooks.service.js";
import type { Row } from "./resources.js";
import type { Resource } from "./rbac.js";

type Payload = Record<string, any>;
type Ctx = { s: Session; record: Row; payload: Payload };
type Result = { patch: Payload; message: string };
type ActionFn = (ctx: Ctx) => Promise<Result>;

const now = () => new Date().toISOString();
const today = () => now().slice(0, 10);

function requireStatus(record: Row, allowed: string[], field = "status") {
  if (!allowed.includes(String(record[field]))) throw new HttpError(409, `Action not allowed while ${field} is "${record[field]}"`);
}

/** State transitions exposed as POST /:resource/:id/:action. */
@Injectable()
export class WorkflowsService {
  private readonly flows: Record<string, Record<string, ActionFn>>;

  constructor(private readonly db: DbService, private readonly repo: Repo, private readonly access: AccessService, private readonly hooks: HooksService) {
    const A = access;
    const entry = (s: Session, action: string, comment?: unknown) => ({ by: s.employeeId, userId: s.userId, userName: s.name, role: s.role, action, at: now(), comment: comment ? String(comment) : "" });
    const withApproval = (r: Row, s: Session, action: string, comment?: unknown) => [...((r.approvals as unknown[]) ?? []), entry(s, action, comment)];

    const twoStep = (finalRoles: string[], finalStatus: string, resource: Resource, link: string, label: string): ActionFn => async ({ s, record, payload }) => {
      A.assertCan(s, resource, "approve");
      if (record.employeeId === s.employeeId && s.role !== "super_admin") throw new HttpError(403, "You can't approve your own request");
      const isFinal = finalRoles.includes(s.role);
      requireStatus(record, isFinal ? ["Pending", "Manager Approved"] : ["Pending"]);
      const status = isFinal ? finalStatus : "Manager Approved";
      await A.notify({ employeeId: record.employeeId }, `${label} ${status.toLowerCase()}`, `Your ${label.toLowerCase()} ${record.code ?? ""} is now "${status}".`, link);
      if (!isFinal) await A.notify({ role: resource === "expenses" ? "finance" : "hr" }, `${label} awaiting final approval`, `${await A.employeeName(record.employeeId)} — ${record.code ?? ""}`, link);
      return { patch: { status, approvals: withApproval(record, s, "Approved", payload.comment) }, message: `${label} ${status.toLowerCase()}` };
    };
    const reject = (resource: Resource, link: string, label: string, from = ["Pending", "Manager Approved"]): ActionFn => async ({ s, record, payload }) => {
      A.assertCan(s, resource, "approve");
      requireStatus(record, from);
      await A.notify({ employeeId: record.employeeId }, `${label} rejected`, `Your ${label.toLowerCase()} was rejected. ${payload.comment ?? ""}`, link);
      return { patch: { status: "Rejected", approvals: withApproval(record, s, "Rejected", payload.comment) }, message: `${label} rejected` };
    };
    const setStatus = (resource: Resource, action: "approve" | "edit", from: string[], to: string, msg: string): ActionFn => async ({ s, record }) => {
      A.assertCan(s, resource, action);
      requireStatus(record, from);
      return { patch: { status: to }, message: msg };
    };

    this.flows = {
      leaves: {
        approve: async (ctx) => {
          const settings = await A.settings<{ leave?: { approvalFlow?: string[] } }>();
          const needsHr = (settings.leave?.approvalFlow ?? ["manager", "hr"]).includes("hr");
          if (!needsHr && ctx.s.role === "manager") {
            A.assertCan(ctx.s, "leaves", "approve");
            requireStatus(ctx.record, ["Pending"]);
            await A.notify({ employeeId: ctx.record.employeeId }, "Leave approved", "Your leave was approved.", "/leave");
            return { patch: { status: "Approved", approvals: withApproval(ctx.record, ctx.s, "Approved", ctx.payload.comment) }, message: "Leave approved" };
          }
          return twoStep(["hr_admin", "hr_manager", "super_admin"], "Approved", "leaves", "/leave", "Leave request")(ctx);
        },
        reject: reject("leaves", "/leave", "Leave request"),
        cancel: async ({ s, record }) => {
          if (record.employeeId !== s.employeeId && !A.isHR(s.role)) throw new HttpError(403, "Only the requester can cancel");
          requireStatus(record, ["Pending", "Manager Approved", "Approved"]);
          if (record.status === "Approved" && String(record.from) <= today() && !A.isHR(s.role)) throw new HttpError(409, "Leave already started; contact HR to cancel");
          return { patch: { status: "Cancelled", approvals: withApproval(record, s, "Cancelled") }, message: "Leave cancelled" };
        },
      },
      expenses: {
        approve: twoStep(["finance", "super_admin"], "Approved", "expenses", "/expenses", "Expense claim"),
        reject: reject("expenses", "/expenses", "Expense claim"),
        reimburse: async ({ s, record }) => {
          A.assertCan(s, "expenses", "approve");
          if (!["finance", "super_admin"].includes(s.role)) throw new HttpError(403, "Only finance can mark reimbursed");
          requireStatus(record, ["Approved"]);
          await A.notify({ employeeId: record.employeeId }, "Expense reimbursed", `AED ${record.amount} for ${record.code} has been reimbursed.`, "/expenses");
          return { patch: { status: "Reimbursed", reimbursedAt: now(), approvals: withApproval(record, s, "Reimbursed") }, message: "Marked as reimbursed" };
        },
      },
      attendanceCorrections: {
        approve: async ({ s, record }) => {
          A.assertCan(s, "attendanceCorrections", "approve");
          requireStatus(record, ["Pending"]);
          const [ih, im] = String(record.requestedCheckIn).split(":").map(Number);
          const [oh, om] = String(record.requestedCheckOut).split(":").map(Number);
          const hours = Math.max(0, Math.round(((oh * 60 + om - (ih * 60 + im) - 60) / 60) * 100) / 100);
          const patch = { date: record.date, checkIn: record.requestedCheckIn, checkOut: record.requestedCheckOut, hours, overtime: Math.max(0, Math.round((hours - 8) * 100) / 100), status: ih * 60 + im > 9 * 60 + 15 ? "Late" : "Present", notes: "Corrected" };
          const existing = (await repo.find("attendance", { employeeId: record.employeeId, date: record.date }))[0];
          if (existing) await repo.update("attendance", existing.id, patch);
          else await repo.insert("attendance", { employeeId: record.employeeId, method: "Correction", ...patch });
          await A.notify({ employeeId: record.employeeId }, "Attendance corrected", `Your correction for ${record.date} was approved.`, "/attendance");
          return { patch: { status: "Approved", reviewedBy: s.employeeId, reviewedAt: now() }, message: "Correction approved and attendance updated" };
        },
        reject: async (ctx) => {
          const r = await reject("attendanceCorrections", "/attendance", "Attendance correction", ["Pending"])(ctx);
          delete r.patch.approvals;
          return { ...r, patch: { ...r.patch, reviewedBy: ctx.s.employeeId, reviewedAt: now() } };
        },
      },
      timesheets: {
        approve: setStatus("timesheets", "approve", ["Submitted"], "Approved", "Timesheet approved"),
        reject: setStatus("timesheets", "approve", ["Submitted"], "Rejected", "Timesheet rejected"),
      },
      salaryRevisions: {
        approve: async ({ s, record, payload }) => {
          A.assertCan(s, "salaryRevisions", "approve");
          requireStatus(record, ["Pending"]);
          const emp = await repo.get("employees", record.employeeId);
          if (!emp) throw new HttpError(404, "Employee not found");
          const sal = emp.salary as Record<string, number>;
          const total = Object.values(sal).reduce((x, y) => x + Number(y), 0);
          const factor = Number(record.newSalary) / (total || 1);
          const salary = Object.fromEntries(Object.entries(sal).map(([k, v]) => [k, k === "medical" ? v : Math.round((Number(v) * factor) / 10) * 10]));
          const patch: Payload = { salary, salaryEffectiveFrom: record.effectiveDate, salaryRevisionId: record.id };
          if (record.newDesignationId && record.newDesignationId !== emp.designationId) patch.designationId = record.newDesignationId;
          await repo.update("employees", emp.id, patch);
          await A.notify({ employeeId: emp.id }, `${record.type} approved`, `Effective ${record.effectiveDate}.`, `/employees/${emp.id}`);
          return { patch: { status: "Approved", approvals: withApproval(record, s, "Approved", payload.comment) }, message: `${record.type} approved — employee record updated` };
        },
        reject: reject("salaryRevisions", "/performance/promotions", "Salary revision", ["Pending"]),
      },
      jobs: {
        approve: setStatus("jobs", "approve", ["Pending Approval", "Draft"], "Open", "Job opening approved and published"),
        hold: setStatus("jobs", "edit", ["Open"], "On Hold", "Job put on hold"),
        reopen: setStatus("jobs", "edit", ["On Hold", "Closed"], "Open", "Job reopened"),
        close: setStatus("jobs", "edit", ["Open", "On Hold"], "Closed", "Job closed"),
      },
      candidates: {
        move: async ({ s, record, payload }) => {
          A.assertCan(s, "candidates", "edit");
          const stage = String(payload.stage);
          const allowed = ["Applied", "Screening", "Shortlisted", "Interview", "Technical Interview", "HR Interview", "Offer", "Hired", "Rejected"];
          if (!allowed.includes(stage)) throw new HttpError(400, "Invalid stage");
          const toDb = (x: string) => x.toLowerCase().replace(/\s+/g, "_");
          await db.query("INSERT INTO candidate_stage_history (candidate_id, from_stage, to_stage, changed_by, reason) VALUES ($1,$2,$3,$4,$5)", [record.id, toDb(record.stage), toDb(stage), s.userId, payload.reason ?? null]);
          return { patch: { stage, rejectionReason: stage === "Rejected" ? String(payload.reason ?? "Not specified") : "" }, message: `Moved to ${stage}` };
        },
        hire: async ({ s, record }) => {
          A.assertCan(s, "employees", "create");
          if (record.employeeId) throw new HttpError(409, "Candidate already converted");
          const job = await repo.get("jobs", record.jobId);
          if (!job) throw new HttpError(404, "Job not found");
          const offer = (await repo.find("offers", { candidateId: record.id }))[0];
          const [first, ...rest] = String(record.name).split(" ");
          const total = Number(offer?.salary ?? record.expectedSalary ?? 10000);
          const basic = Math.round((total * 0.6) / 100) * 100;
          const joining = String(offer?.joiningDate ?? today());
          const shift = await db.one<{ id: string }>("SELECT id FROM shifts ORDER BY start_time LIMIT 1");
          let email = `${String(record.name).toLowerCase().replace(/[^a-z]+/g, ".")}@${config.companyEmailDomain}`;
          if ((await repo.find("employees", { email })).length) email = email.replace("@", `.${Date.now() % 1000}@`);
          const emp = await repo.insert("employees", {
            firstName: first, lastName: rest.join(" ") || "-", email, personalEmail: record.email, phone: record.phone,
            designationId: job.designationId, departmentId: job.departmentId, managerId: job.hiringManagerId, locationId: job.locationId,
            employmentType: job.employmentType ?? "Full-time", workMode: "Office", joiningDate: joining, status: "Probation", shiftId: shift?.id,
            probationEndDate: new Date(new Date(joining).getTime() + 180 * 86400000).toISOString().slice(0, 10), skills: record.skills ?? [],
            salary: { basic, housing: Math.round(basic * 0.4), transport: Math.round(basic * 0.1), medical: 500, other: Math.max(0, total - basic - Math.round(basic * 0.5) - 500) },
            avatarColor: "#6366f1", noticePeriodDays: 30,
          });
          await repo.insert("onboarding", { employeeId: emp.id, startDate: joining, buddyId: job.hiringManagerId, stage: "Offer Accepted", tasks: (await hooks.onboardingTasks(joining)).map((t, i) => (i === 0 ? { ...t, done: true } : t)) });
          if (offer) await repo.update("offers", offer.id, { status: "Accepted" });
          await A.notify({ role: "hr" }, "New hire created", `${record.name} has been converted to employee ${emp.code}; onboarding started.`, "/onboarding");
          return { patch: { stage: "Hired", employeeId: emp.id }, message: `Hired! Employee ${emp.code} and onboarding checklist created` };
        },
      },
      offers: {
        send: async (ctx) => ({ ...(await setStatus("offers", "edit", ["Draft"], "Sent", "Offer sent to candidate")(ctx)), patch: { status: "Sent", sentDate: today() } }),
        accept: async ({ s, record }) => {
          A.assertCan(s, "offers", "edit");
          requireStatus(record, ["Sent"]);
          await repo.update("candidates", record.candidateId, { stage: "Offer" });
          return { patch: { status: "Accepted" }, message: "Offer accepted — use 'Convert to employee' on the candidate to hire" };
        },
        decline: setStatus("offers", "edit", ["Sent"], "Declined", "Offer marked as declined"),
      },
      payrollRuns: {
        approve: async ({ s, record }) => {
          A.assertCan(s, "payrollRuns", "approve");
          requireStatus(record, ["Draft"]);
          await A.notify({ role: "finance" }, "Payroll approved", `${record.month} payroll approved.`, "/payroll");
          return { patch: { status: "Approved", approvedBy: s.userId, approvedAt: now() }, message: "Payroll approved" };
        },
        lock: async ({ s, record }) => {
          A.assertCan(s, "payrollRuns", "manage");
          requireStatus(record, ["Approved"]);
          return { patch: { status: "Locked", lockedAt: now() }, message: "Payroll locked — no further changes allowed" };
        },
        pay: async ({ s, record }) => {
          A.assertCan(s, "payrollRuns", "manage");
          requireStatus(record, ["Approved", "Locked"]);
          for (const item of record.items as { employeeId: string; net: number; loanDeduction: number; itemId: string }[]) {
            await A.notify({ employeeId: item.employeeId }, "Salary credited", `Your salary for ${record.month} (AED ${Number(item.net).toLocaleString()}) has been processed.`, "/payroll/payslips");
            let remaining = Number(item.loanDeduction ?? 0);
            if (remaining > 0) {
              for (const loan of await repo.find("loans", { employeeId: item.employeeId, status: "Active" })) {
                const amt = Math.min(remaining, Number(loan.installment), Number(loan.balance));
                if (amt <= 0) continue;
                await db.query("INSERT INTO loan_repayments (loan_id, payroll_item_id, amount, paid_on) VALUES ($1,$2,$3,$4)", [loan.id, item.itemId, amt, today()]);
                const balance = Number(loan.balance) - amt;
                await repo.update("loans", loan.id, { balance, status: balance <= 0 ? "Closed" : "Active" });
                remaining -= amt;
              }
            }
          }
          return { patch: { status: "Paid", lockedAt: record.locked ? undefined : now(), paidAt: now() }, message: "Payroll marked as paid; payslips released" };
        },
        reopen: async ({ s, record }) => {
          A.assertCan(s, "payrollRuns", "manage");
          if (record.locked) throw new HttpError(409, "Locked payroll can't be reopened");
          requireStatus(record, ["Approved"]);
          return { patch: { status: "Draft", approvedBy: null, approvedAt: null }, message: "Payroll returned to draft" };
        },
      },
      offboarding: {
        approve: async ({ s, record }) => {
          A.assertCan(s, "offboarding", "approve");
          requireStatus(record, ["Submitted", "HR Review"], "stage");
          if (record.stage === "HR Review" && !A.isHR(s.role)) throw new HttpError(403, "Awaiting HR review");
          if (record.employeeId === s.employeeId && s.role !== "super_admin") throw new HttpError(403, "You can't approve your own resignation");
          await repo.update("employees", record.employeeId, { status: "Notice Period", lastWorkingDay: record.lastWorkingDay });
          const checklist = (record.checklist as { done: boolean }[]).map((c, i) => (i <= (A.isHR(s.role) ? 1 : 0) ? { ...c, done: true } : c));
          await A.notify({ employeeId: record.employeeId }, "Resignation update", A.isHR(s.role) ? "Your resignation was accepted; notice period started." : "Your manager approved your resignation.", "/offboarding");
          return { patch: { stage: A.isHR(s.role) ? "Notice Period" : "HR Review", checklist }, message: A.isHR(s.role) ? "Resignation accepted — notice period started" : "Approved — forwarded to HR" };
        },
        complete: async ({ s, record }) => {
          A.assertCan(s, "offboarding", "edit");
          requireStatus(record, ["Notice Period"], "stage");
          const pending = (record.checklist as { done: boolean }[]).filter((c) => !c.done).length;
          if (pending) throw new HttpError(409, `${pending} checklist item(s) still pending`);
          await repo.update("employees", record.employeeId, { status: "Resigned" });
          await db.query("UPDATE users SET is_active = false, updated_at = now() WHERE employee_id = $1", [record.employeeId]);
          await db.query("UPDATE refresh_tokens SET revoked_at = now() WHERE revoked_at IS NULL AND user_id IN (SELECT id FROM users WHERE employee_id=$1)", [record.employeeId]);
          return { patch: { stage: "Completed", completedAt: now() }, message: "Exit completed; system access revoked" };
        },
      },
      settlements: {
        approve: async (ctx) => ({ ...(await setStatus("settlements", "approve", ["Draft"], "Approved", "Final settlement approved")(ctx)), patch: { status: "Approved", approvedBy: ctx.s.userId } }),
        pay: async ({ s, record }) => {
          A.assertCan(s, "settlements", "approve");
          requireStatus(record, ["Approved"]);
          return { patch: { status: "Paid", paidAt: now() }, message: "Settlement marked as paid" };
        },
      },
      documents: {
        verify: async ({ s, payload }) => {
          A.assertCan(s, "documents", "approve");
          const status = payload.status === "Rejected" ? "Rejected" : "Verified";
          return { patch: { status, verifiedBy: s.userId, verifiedAt: now(), ...(payload.note ? { notes: payload.note } : {}) }, message: `Document ${status.toLowerCase()}` };
        },
      },
      users: {
        resetPassword: async ({ s, payload }) => {
          A.assertCan(s, "users", "manage");
          const pwd = String(payload.password ?? "");
          if (pwd.length < 8) throw new HttpError(400, "Password must be at least 8 characters");
          return { patch: { passwordHash: bcrypt.hashSync(pwd, 10), failedAttempts: 0, lockedUntil: null, passwordChangedAt: now() }, message: "Password reset" };
        },
        unlock: async ({ s }) => {
          A.assertCan(s, "users", "edit");
          return { patch: { failedAttempts: 0, lockedUntil: null }, message: "Account unlocked" };
        },
        toggleActive: async ({ s, record }) => {
          A.assertCan(s, "users", "edit");
          if (record.id === s.userId) throw new HttpError(409, "You can't deactivate yourself");
          if (record.active) await db.query("UPDATE refresh_tokens SET revoked_at = now() WHERE user_id=$1 AND revoked_at IS NULL", [record.id]);
          return { patch: { active: !record.active }, message: record.active ? "User deactivated" : "User activated" };
        },
      },
      tickets: {
        comment: async ({ s, record, payload }) => {
          const text = String(payload.text ?? payload.body ?? "").trim();
          if (!text) throw new HttpError(400, "Comment is empty");
          const isOwner = record.employeeId === s.employeeId;
          if (!isOwner) A.assertCan(s, "tickets", "edit");
          if (!isOwner) await A.notify({ employeeId: record.employeeId }, `Update on ${record.code}`, text.slice(0, 120), "/helpdesk");
          const patch: Payload = { comments: [...((record.comments as unknown[]) ?? []), { by: s.employeeId, userId: s.userId, userName: s.name, at: now(), text, internal: !!payload.isInternal }] };
          if (!isOwner && record.status === "Open") patch.status = "In Progress";
          return { patch, message: "Comment added" };
        },
        resolve: async ({ s, record, payload }) => {
          A.assertCan(s, "tickets", "approve");
          await A.notify({ employeeId: record.employeeId }, `${record.code} resolved`, String(payload.resolution ?? ""), "/helpdesk");
          return { patch: { status: "Resolved", resolution: String(payload.resolution ?? "Resolved"), resolvedAt: now() }, message: "Ticket resolved" };
        },
      },
    };
  }

  async run(key: string, resource: Resource, action: string, s: Session, record: Row, payload: Payload) {
    const camel = action === "comments" ? "comment" : action.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const fn = this.flows[key]?.[camel];
    if (!fn) throw new HttpError(400, `Unknown action "${action}" for ${key}`);
    await this.access.assertInScope(s, key, resource, record);
    return fn({ s, record, payload });
  }
}
