import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { DbService } from "../database/db.service.js";
import { CurrentSession } from "../auth/auth.guard.js";
import { AccessService, HttpError, type Session } from "../domain/access.service.js";
import { Repo } from "../domain/repository.service.js";
import { isUuid } from "../domain/resources.js";
import { mutate, sendCsv, todayIso } from "./support.js";

@Controller()
export class PeopleController {
  constructor(private readonly db: DbService, private readonly repo: Repo, private readonly access: AccessService) {}

  private tx<T>(fn: () => Promise<T>) {
    return this.db.tx(fn);
  }

  // ----------------------------------------------------------------------- employees
  @Get("employees/export")
  async exportEmployees(@CurrentSession() s: Session, @Res() res: Response) {
    this.access.assertCan(s, "employees", "export");
    const rows = await this.access.filterByScope(s, "employees", "employees", await this.repo.all("employees"));
    const [deps, des] = await Promise.all([this.repo.all("departments"), this.repo.all("designations")]);
    const dn = new Map(deps.map((d) => [d.id, d.name])), gn = new Map(des.map((d) => [d.id, d.title]));
    const byId = new Map(rows.map((r) => [r.id, r.name]));
    await this.access.audit(s, "Employees Exported", "employees", null, { rows: rows.length });
    sendCsv(res, "employees.csv", rows.map((e) => ({ code: e.code, name: e.name, email: e.email, phone: e.phone, department: dn.get(e.departmentId), designation: gn.get(e.designationId), manager: byId.get(e.managerId) ?? "", employmentType: e.employmentType, workMode: e.workMode, joiningDate: e.joiningDate, status: e.status, nationality: e.nationality, gender: e.gender, ...(e.salary ? { totalSalary: Object.values(e.salary as Record<string, number>).reduce((a, b) => a + Number(b), 0) } : {}) })));
  }

  @Get("employees/:id/salary-history")
  async salaryHistory(@CurrentSession() s: Session, @Param("id") id: string) {
    const emp = await this.repo.get("employees", id);
    if (!emp) throw new HttpError(404, "Employee not found");
    if (emp.id !== s.employeeId) this.access.assertCan(s, "compensation", "view");
    const structures = await this.db.query(
      `SELECT id, basic, housing, transport, medical, other_allowances AS "otherAllowances", basic + housing + transport + medical + other_allowances AS total,
              effective_from AS "effectiveFrom", effective_to AS "effectiveTo", salary_revision_id AS "salaryRevisionId" FROM salary_structures WHERE employee_id=$1 ORDER BY effective_from DESC`,
      [id],
    );
    return { structures, revisions: await this.repo.find("salaryRevisions", { employeeId: id }) };
  }

  @Put("employees/:id/salary")
  salary(@CurrentSession() s: Session, @Param("id") id: string, @Body() b: { basic: number; housing?: number; transport?: number; medical?: number; otherAllowances?: number; other?: number; effectiveFrom?: string }) {
    this.access.assertCan(s, "compensation", "edit");
    return this.tx(() => mutate(this.repo, this.access, s, "employees", id, "edit", () => ({ salary: { basic: b.basic, housing: b.housing ?? 0, transport: b.transport ?? 0, medical: b.medical ?? 0, other: b.otherAllowances ?? b.other ?? 0 }, salaryEffectiveFrom: b.effectiveFrom }), "Salary Updated"));
  }

  @Put("employees/:id/bank-account")
  bank(@CurrentSession() s: Session, @Param("id") id: string, @Body() b: { bankName: string; iban: string; routingCode?: string }) {
    if (!b?.iban) throw new HttpError(400, "IBAN is required");
    return this.tx(() => mutate(this.repo, this.access, s, "employees", id, "edit", () => ({ bank: { name: b.bankName, iban: b.iban.replace(/\s+/g, ""), routingCode: b.routingCode } }), "Bank Account Updated"));
  }

  @Put("employees/:id/emergency-contacts")
  emergency(@CurrentSession() s: Session, @Param("id") id: string, @Body() b: { name: string; relation?: string; phone: string } | { name: string; relation?: string; phone: string }[]) {
    const c = Array.isArray(b) ? b[0] : b;
    return this.tx(() => mutate(this.repo, this.access, s, "employees", id, "edit", () => ({ emergencyContact: c })));
  }

  @Get("employees/:id/timeline")
  async timeline(@CurrentSession() s: Session, @Param("id") id: string) {
    this.access.assertCan(s, "employees", "view");
    const emp = await this.repo.get("employees", id);
    if (!emp) throw new HttpError(404, "Employee not found");
    await this.access.assertInScope(s, "employees", "employees", emp);
    return this.db.query(
      `SELECT created_at AS at, user_name AS "by", action, entity, entity_id AS "entityId", changes FROM audit_logs
       WHERE entity_id = $1::text OR (entity IN ('leaves','expenses','salaryRevisions','cases','recognitions','documents') AND entity_id IN (
         SELECT id::text FROM leave_requests WHERE employee_id=$1 UNION SELECT id::text FROM expense_claims WHERE employee_id=$1
         UNION SELECT id::text FROM salary_revisions WHERE employee_id=$1 UNION SELECT id::text FROM recognitions WHERE employee_id=$1
         UNION SELECT id::text FROM documents WHERE employee_id=$1)) ORDER BY created_at DESC LIMIT 100`,
      [id],
    );
  }

  // ----------------------------------------------------------------------- onboarding / exits / goals / reviews
  @Patch("onboarding/:id/tasks/:taskId")
  onboardingTask(@CurrentSession() s: Session, @Param("id") id: string, @Param("taskId") taskId: string, @Body() b: { isDone?: boolean; done?: boolean }) {
    return this.tx(() =>
      mutate(this.repo, this.access, s, "onboarding", id, "edit", (r) => {
        const tasks = (r.tasks as { id: string; done: boolean }[]).map((t) => (t.id === taskId ? { ...t, done: !!(b.isDone ?? b.done) } : t));
        const ratio = tasks.filter((t) => t.done).length / (tasks.length || 1);
        const stages = ["Offer Accepted", "Documents Collection", "HR Verification", "IT Setup", "Manager Setup", "Employee Joining", "Onboarding Complete"];
        return { tasks, stage: stages[Math.min(6, Math.floor(ratio * 6))], ...(ratio === 1 ? { completedAt: new Date().toISOString() } : {}) };
      }),
    );
  }

  @Patch("exits/:id/checklist/:itemId")
  exitItem(@CurrentSession() s: Session, @Param("id") id: string, @Param("itemId") itemId: string, @Body() b: { isDone?: boolean; done?: boolean }) {
    return this.tx(() => mutate(this.repo, this.access, s, "offboarding", id, "edit", (r) => ({ checklist: (r.checklist as { id: string }[]).map((c) => (c.id === itemId ? { ...c, done: !!(b.isDone ?? b.done) } : c)) })));
  }

  @Post("exits/:id/exit-interview")
  exitInterview(@CurrentSession() s: Session, @Param("id") id: string, @Body() b: { rating: number; feedback: string }) {
    return this.tx(() => mutate(this.repo, this.access, s, "offboarding", id, "edit", (r) => ({ exitInterview: { rating: Number(b.rating), feedback: b.feedback }, checklist: (r.checklist as { title: string }[]).map((c) => (c.title === "Exit interview" ? { ...c, done: true } : c)) }), "Exit Interview Recorded"));
  }

  @Patch("goals/:id/progress")
  goalProgress(@CurrentSession() s: Session, @Param("id") id: string, @Body() b: { progress?: number; keyResults?: unknown[]; status?: string }) {
    return this.tx(() =>
      mutate(this.repo, this.access, s, "goals", id, "edit", () => {
        const p: Record<string, unknown> = {};
        if (b.progress !== undefined) p.progress = Math.max(0, Math.min(100, Number(b.progress)));
        if (b.keyResults) p.keyResults = b.keyResults;
        if (b.status) p.status = b.status;
        if (p.progress === 100) p.status = "Completed";
        return p;
      }),
    );
  }

  @Post("reviews/:id/self-assessment")
  selfAssessment(@CurrentSession() s: Session, @Param("id") id: string, @Body() b: { selfScore: number; strengths?: string; improvements?: string }) {
    return this.tx(() =>
      mutate(this.repo, this.access, s, "reviews", id, "edit", (r) => {
        if (r.employeeId !== s.employeeId) throw new HttpError(403, "Only the employee can submit a self-assessment");
        if (!(b.selfScore >= 1 && b.selfScore <= 5)) throw new HttpError(400, "selfScore must be between 1 and 5");
        return { selfScore: b.selfScore, strengths: b.strengths ?? r.strengths, improvements: b.improvements ?? r.improvements, status: r.managerScore != null ? "Completed" : "Manager Review" };
      }, "Self Assessment Submitted"),
    );
  }

  @Post("reviews/:id/manager-assessment")
  managerAssessment(@CurrentSession() s: Session, @Param("id") id: string, @Body() b: { managerScore: number; strengths?: string; improvements?: string; promotionRecommended?: boolean }) {
    return this.tx(() =>
      mutate(this.repo, this.access, s, "reviews", id, "edit", async (r) => {
        if (r.employeeId === s.employeeId) throw new HttpError(403, "You can't rate your own review");
        if (!(b.managerScore >= 1 && b.managerScore <= 5)) throw new HttpError(400, "managerScore must be between 1 and 5");
        const self = Number(r.selfScore ?? b.managerScore);
        await this.access.notify({ employeeId: r.employeeId }, "Review completed", `Your ${r.cycle} review is complete.`, "/performance/reviews");
        return { managerScore: b.managerScore, strengths: b.strengths ?? r.strengths, improvements: b.improvements ?? r.improvements, promotionRecommended: !!b.promotionRecommended, finalRating: Math.round(((self + b.managerScore * 2) / 3) * 10) / 10, status: "Completed" };
      }, "Manager Assessment Submitted"),
    );
  }

  // ----------------------------------------------------------------------- tickets
  @Get("tickets/:id/comments")
  async ticketComments(@CurrentSession() s: Session, @Param("id") id: string) {
    this.access.assertCan(s, "tickets", "view");
    const t = await this.repo.get("tickets", id);
    if (!t) throw new HttpError(404, "Ticket not found");
    await this.access.assertInScope(s, "tickets", "tickets", t);
    return (t.comments as { internal?: boolean }[]).filter((c) => !c.internal || this.access.can(s.role, "tickets", "edit"));
  }

  @Post("tickets/:id/assign")
  @HttpCode(200)
  assign(@CurrentSession() s: Session, @Param("id") id: string, @Body() b: { assignedTo: string }) {
    return this.tx(() =>
      mutate(this.repo, this.access, s, "tickets", id, "edit", async (r) => {
        await this.access.notify({ employeeId: b.assignedTo }, `Ticket ${r.code} assigned to you`, String(r.subject), "/helpdesk");
        return { assignedTo: b.assignedTo, ...(r.status === "Open" ? { status: "In Progress" } : {}) };
      }, "Ticket Assigned"),
    );
  }

  // ----------------------------------------------------------------------- documents
  @Get("documents/expiring")
  async expiring(@CurrentSession() s: Session, @Query("withinDays") withinDays = "90") {
    this.access.assertCan(s, "documents", "view");
    const rows = await this.db.query<{ id: string }>("SELECT id FROM documents WHERE expiry_date IS NOT NULL AND expiry_date <= current_date + $1::int ORDER BY expiry_date", [Number(withinDays) || 90]);
    const docs = await this.repo.all("documents", { id: rows.map((r) => r.id) });
    return this.access.filterByScope(s, "documents", "documents", docs);
  }

  @Post("documents/:id/versions")
  newVersion(@CurrentSession() s: Session, @Param("id") id: string, @Body() b: { fileId?: string; fileName?: string; note?: string; expiryDate?: string; number?: string }) {
    if (!b.fileId && !b.fileName) throw new HttpError(400, "fileId (from POST /files) or fileName is required");
    return this.tx(() =>
      mutate(this.repo, this.access, s, "documents", id, "edit", async (r) => {
        const fileId = await this.repo.fileId(b.fileId ?? b.fileName);
        const version = Number(r.version ?? 1) + 1;
        await this.db.query("INSERT INTO document_versions (document_id, version, file_id, uploaded_by, note) VALUES ($1,$2,$3,$4,$5)", [id, version, fileId, s.userId, b.note ?? null]);
        return { fileName: fileId, version, uploadedBy: s.userId, status: this.access.can(s.role, "documents", "approve") ? r.status : "Pending Verification", ...(b.expiryDate ? { expiryDate: b.expiryDate } : {}), ...(b.number ? { number: b.number } : {}) };
      }, "Document Version Uploaded"),
    );
  }

  // ----------------------------------------------------------------------- assets
  @Post("assets/:id/assign")
  @HttpCode(200)
  assignAsset(@CurrentSession() s: Session, @Param("id") id: string, @Body() b: { employeeId: string; assignedOn?: string }) {
    if (!isUuid(b?.employeeId)) throw new HttpError(400, "employeeId is required");
    return this.tx(() =>
      mutate(this.repo, this.access, s, "assets", id, "edit", async (r) => {
        if (["Retired"].includes(r.status)) throw new HttpError(409, "Retired assets can't be assigned");
        await this.access.notify({ employeeId: b.employeeId }, "Asset assigned", `${r.name} (${r.code}) has been assigned to you.`, "/assets");
        return { assignedTo: b.employeeId, assignedDate: b.assignedOn ?? todayIso(), status: "Assigned" };
      }, "Asset Assigned"),
    );
  }

  @Post("assets/:id/return")
  @HttpCode(200)
  returnAsset(@CurrentSession() s: Session, @Param("id") id: string, @Body() b: { condition?: string }) {
    return this.tx(() => mutate(this.repo, this.access, s, "assets", id, "edit", () => ({ assignedTo: null, status: "In Stock", ...(b?.condition ? { condition: b.condition } : {}) }), "Asset Returned"));
  }

  @Post("assets/:id/maintenance")
  @HttpCode(200)
  maintenance(@CurrentSession() s: Session, @Param("id") id: string, @Body() b: { date?: string; description: string; cost?: number; vendor?: string }) {
    if (!b?.description) throw new HttpError(400, "description is required");
    return this.tx(() => mutate(this.repo, this.access, s, "assets", id, "edit", (r) => ({ status: "Maintenance", maintenanceHistory: [...(r.maintenanceHistory as unknown[]).reverse(), { date: b.date ?? todayIso(), note: b.description, cost: b.cost, vendor: b.vendor }] }), "Asset Maintenance Logged"));
  }

  // ----------------------------------------------------------------------- trainings
  @Post("trainings/:id/enrollments")
  enroll(@CurrentSession() s: Session, @Param("id") id: string, @Body() b: { employeeIds: string[] }) {
    return this.tx(() =>
      mutate(this.repo, this.access, s, "trainings", id, "edit", (r) => {
        const next = [...new Set([...(r.enrolled as string[]), ...(b.employeeIds ?? [])])];
        if (next.length > Number(r.seats)) throw new HttpError(409, `Only ${r.seats} seats available`);
        return { enrolled: next };
      }, "Training Enrollment"),
    );
  }

  @Delete("trainings/:id/enrollments/:employeeId")
  unenroll(@CurrentSession() s: Session, @Param("id") id: string, @Param("employeeId") employeeId: string) {
    return this.tx(() => mutate(this.repo, this.access, s, "trainings", id, "edit", (r) => ({ enrolled: (r.enrolled as string[]).filter((x) => x !== employeeId) }), "Training Enrollment Removed"));
  }

  // ----------------------------------------------------------------------- cases & surveys
  @Post("cases/:id/notes")
  async caseNote(@CurrentSession() s: Session, @Param("id") id: string, @Body() b: { body: string }) {
    this.access.assertCan(s, "cases", "edit");
    const c = await this.repo.get("cases", id);
    if (!c) throw new HttpError(404, "Case not found");
    await this.access.assertInScope(s, "cases", "cases", c);
    if (!b?.body?.trim()) throw new HttpError(400, "Note is empty");
    await this.db.query("INSERT INTO er_case_notes (case_id, author_user_id, body) VALUES ($1,$2,$3)", [id, s.userId, b.body.trim()]);
    await this.access.audit(s, "Case Note Added", "cases", id, { code: c.code });
    return this.repo.get("cases", id);
  }

  @Post("surveys/:id/responses")
  async respond(@CurrentSession() s: Session, @Param("id") id: string, @Body() b: { answers: Record<string, unknown> }) {
    const survey = await this.repo.get("surveys", id);
    if (!survey) throw new HttpError(404, "Survey not found");
    if (survey.status !== "Active") throw new HttpError(409, "This survey is not open");
    if (s.employeeId && !survey.anonymous && (await this.db.one("SELECT 1 FROM survey_responses WHERE survey_id=$1 AND employee_id=$2", [id, s.employeeId]))) throw new HttpError(409, "You already responded");
    await this.db.query("INSERT INTO survey_responses (survey_id, employee_id, answers) VALUES ($1,$2,$3)", [id, survey.anonymous ? null : s.employeeId, JSON.stringify(b?.answers ?? {})]);
    return { ok: true };
  }

  @Get("surveys/:id/results")
  async results(@CurrentSession() s: Session, @Param("id") id: string) {
    this.access.assertCan(s, "surveys", "view");
    const survey = await this.repo.get("surveys", id);
    if (!survey) throw new HttpError(404, "Survey not found");
    const rows = await this.db.query<{ answers: Record<string, unknown> }>("SELECT answers FROM survey_responses WHERE survey_id=$1", [id]);
    const questions = (survey.questions as { id: string; text: string; type: string }[]) ?? [];
    const perQuestion = questions.map((q) => {
      const vals = rows.map((r) => r.answers?.[q.id]).filter((v) => v !== undefined && v !== null);
      const nums = vals.map(Number).filter((n) => !isNaN(n));
      return { id: q.id, text: q.text, type: q.type, responses: vals.length, average: q.type === "scale" && nums.length ? Math.round((nums.reduce((a, b2) => a + b2, 0) / nums.length) * 10) / 10 : null, answers: q.type === "text" ? vals : undefined };
    });
    const scales = perQuestion.filter((q) => q.average != null);
    const engagementScore = scales.length ? Math.round((scales.reduce((t, q) => t + Number(q.average), 0) / scales.length / 5) * 1000) / 10 : survey.engagementScore;
    return { survey: { id, title: survey.title, status: survey.status }, responses: rows.length, engagementScore, questions: perQuestion };
  }
}
