import { Body, Controller, Get, Param, Patch, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { DbService } from "../database/db.service.js";
import { CurrentSession } from "../auth/auth.guard.js";
import { AccessService, HttpError, type Session } from "../domain/access.service.js";
import { Repo } from "../domain/repository.service.js";
import { calcGratuity, leaveBalances, payrollTotals, recomputeItem, salaryTotal, workingDays, type LeaveLite, type LeaveTypeLite, type PayrollItem, type Salary } from "../domain/hr.js";
import { sendCsv } from "./support.js";

@Controller()
export class PayController {
  constructor(private readonly db: DbService, private readonly repo: Repo, private readonly access: AccessService) {}

  /** POST /payroll-runs { period } — calculate (or recalculate a draft) payroll. */
  @Post("payroll-runs")
  async run(@CurrentSession() s: Session, @Body() b: { period?: string; month?: string }) {
    this.access.assertCan(s, "payrollRuns", "create");
    const month = b?.period ?? b?.month ?? "";
    if (!/^\d{4}-\d{2}$/.test(month)) throw new HttpError(400, "period must be in YYYY-MM format");
    return this.db.tx(async () => {
      const existing = (await this.repo.find("payrollRuns", { month }))[0];
      if (existing && existing.status !== "Draft") throw new HttpError(409, `Payroll for ${month} is already ${existing.status}`);
      const [y, m] = month.split("-").map(Number);
      const first = `${month}-01`;
      const last = `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
      const holidays = (await this.repo.all("holidays")).map((h) => h.date);
      const totalWorking = workingDays(first, last, holidays);
      const otRate = Number((await this.access.settings<{ payroll?: { overtimeRate?: number } }>()).payroll?.overtimeRate ?? 1.25);
      const unpaidTypes = (await this.repo.all("leaveTypes", { paid: false })).map((t) => t.id);
      const employees = (await this.repo.all("employees")).filter((e) => e.joiningDate <= last && !["Resigned", "Terminated"].includes(e.status));
      const attendance = (await this.repo.all("attendance")).filter((a) => a.date >= first && a.date <= last);
      const leaves = (await this.repo.all("leaves", { status: "Approved" })).filter((l) => l.from <= last && l.to >= first);
      const loans = (await this.repo.all("loans", { status: "Active" })).filter((l) => Number(l.balance) > 0);

      const items: PayrollItem[] = employees.map((e) => {
        const sal = e.salary as Salary;
        const dailyRate = salaryTotal(sal) / 30;
        const eligibleDays = e.joiningDate > first ? workingDays(e.joiningDate, last, holidays) : totalWorking;
        const pro = totalWorking ? eligibleDays / totalWorking : 1;
        const att = attendance.filter((a) => a.employeeId === e.id);
        const overtimeHours = Math.round(att.reduce((t, a) => t + Number(a.overtime ?? 0), 0) * 100) / 100;
        const absentDays = att.filter((a) => a.status === "Absent").length;
        const unpaidLeaveDays = leaves.filter((l) => l.employeeId === e.id && unpaidTypes.includes(l.leaveTypeId)).reduce((t, l) => t + workingDays(l.from < first ? first : l.from, l.to > last ? last : l.to, holidays), 0);
        const loanDeduction = loans.filter((l) => l.employeeId === e.id).reduce((t, l) => t + Math.min(Number(l.installment), Number(l.balance)), 0);
        return recomputeItem({
          employeeId: e.id, basic: Math.round(sal.basic * pro), housing: Math.round(sal.housing * pro), transport: Math.round(sal.transport * pro), medical: Math.round(sal.medical * pro), otherAllowances: Math.round(sal.other * pro),
          overtimeHours, overtime: Math.round(overtimeHours * (sal.basic / 30 / 8) * otRate), bonus: 0, commission: 0,
          unpaidLeaveDeduction: Math.round((unpaidLeaveDays + absentDays) * dailyRate), loanDeduction, otherDeductions: 0, gross: 0, deductions: 0, net: 0,
          workingDays: totalWorking, paidDays: eligibleDays - unpaidLeaveDays - absentDays, absentDays, unpaidLeaveDays,
        });
      });
      const data = { month, status: "Draft", items, totals: payrollTotals(items), employeeCount: items.length, workingDays: totalWorking, createdBy: s.userId };
      const row = existing ? await this.repo.update("payrollRuns", existing.id, data) : await this.repo.insert("payrollRuns", data);
      await this.access.audit(s, existing ? "Payroll Recalculated" : "Payroll Generated", "payrollRuns", row!.id, { period: month, employees: items.length, net: data.totals.net });
      return row;
    });
  }

  @Patch("payroll-runs/:id/items/:employeeId")
  async adjust(@CurrentSession() s: Session, @Param("id") id: string, @Param("employeeId") employeeId: string, @Body() b: Partial<PayrollItem>) {
    this.access.assertCan(s, "payrollRuns", "edit");
    const run = await this.repo.get("payrollRuns", id);
    if (!run) throw new HttpError(404, "Payroll run not found");
    if (run.locked || run.status !== "Draft") throw new HttpError(409, "Only draft payroll can be adjusted");
    const allowed = ["basic", "housing", "transport", "medical", "otherAllowances", "overtime", "bonus", "commission", "unpaidLeaveDeduction", "loanDeduction", "otherDeductions", "notes"] as const;
    let found = false;
    const items = (run.items as PayrollItem[]).map((i) => {
      if (i.employeeId !== employeeId) return i;
      found = true;
      const next = { ...i } as unknown as Record<string, unknown>;
      for (const k of allowed) if (b[k as keyof PayrollItem] !== undefined) next[k] = k === "notes" ? b[k as keyof PayrollItem] : Number(b[k as keyof PayrollItem]);
      return recomputeItem(next as unknown as PayrollItem);
    });
    if (!found) throw new HttpError(404, "Employee is not in this payroll run");
    return this.db.tx(async () => {
      const u = await this.repo.update("payrollRuns", id, { items, totals: payrollTotals(items) });
      await this.access.audit(s, "Payroll Adjusted", "payrollRuns", id, { employeeId, changes: b });
      return u;
    });
  }

  @Get("payroll-runs/:id/wps")
  async wps(@CurrentSession() s: Session, @Param("id") id: string, @Res() res: Response) {
    this.access.assertCan(s, "payrollRuns", "export");
    const run = await this.repo.get("payrollRuns", id);
    if (!run) throw new HttpError(404, "Payroll run not found");
    if (run.status === "Draft") throw new HttpError(409, "Approve the payroll before exporting the WPS file");
    const settings = await this.access.settings<{ company: { molEstablishmentId: string }; payroll: { wpsBankCode: string } }>();
    const [y, m] = String(run.month).split("-");
    const daysInMonth = new Date(Number(y), Number(m), 0).getDate();
    const items = run.items as PayrollItem[];
    const emps = new Map((await this.repo.all("employees", { id: items.map((i) => i.employeeId) }, { includeDeleted: true })).map((e) => [e.id, e]));
    const lines = items.map((i) => {
      const e = emps.get(i.employeeId);
      const fixed = i.basic + i.housing + i.transport + i.medical + i.otherAllowances;
      return ["EDR", e?.laborCardNumber ?? "", e?.bank?.routingCode ?? "", e?.bank?.iban ?? "", `${run.month}-01`, `${run.month}-${daysInMonth}`, daysInMonth, fixed.toFixed(2), (i.overtime + i.bonus + i.commission - i.deductions).toFixed(2), i.unpaidLeaveDays ?? 0].join(",");
    });
    const total = items.reduce((t, i) => t + i.net, 0);
    const now = new Date();
    lines.push(["SCR", settings.company?.molEstablishmentId ?? "", settings.payroll?.wpsBankCode ?? "", now.toISOString().slice(0, 10), now.toISOString().slice(11, 16).replace(":", ""), `${m}${y}`, items.length, total.toFixed(2), "AED", "MedxDashboard"].join(","));
    await this.access.audit(s, "WPS File Exported", "payrollRuns", id, { records: items.length, total });
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${settings.company?.molEstablishmentId ?? "EST"}_${y}${m}.SIF"`);
    res.send(lines.join("\n"));
  }

  @Get("payroll-runs/:id/register")
  async register(@CurrentSession() s: Session, @Param("id") id: string, @Res() res: Response) {
    this.access.assertCan(s, "payrollRuns", "export");
    const run = await this.repo.get("payrollRuns", id);
    if (!run) throw new HttpError(404, "Payroll run not found");
    const items = run.items as PayrollItem[];
    const emps = new Map((await this.repo.all("employees", { id: items.map((i) => i.employeeId) }, { includeDeleted: true })).map((e) => [e.id, e]));
    sendCsv(res, `salary-register-${run.month}.csv`, items.map((i) => ({ "Employee ID": emps.get(i.employeeId)?.code, Name: emps.get(i.employeeId)?.name, Basic: i.basic, Housing: i.housing, Transport: i.transport, Medical: i.medical, Other: i.otherAllowances, "OT Hours": i.overtimeHours, Overtime: i.overtime, Bonus: i.bonus, Commission: i.commission, "Unpaid/Absence": i.unpaidLeaveDeduction, Loan: i.loanDeduction, "Other Deductions": i.otherDeductions, Gross: i.gross, Deductions: i.deductions, Net: i.net })));
  }

  @Get("payslips")
  async payslips(@CurrentSession() s: Session, @Query("employeeId") employeeId?: string, @Query("period") period?: string) {
    this.access.assertCan(s, "payrollRuns", "view");
    const runs = await this.access.filterByScope(s, "payrollRuns", "payrollRuns", await this.repo.all("payrollRuns", period ? { month: period } : {}));
    return runs.flatMap((r) => (r.items as PayrollItem[]).filter((i) => !employeeId || i.employeeId === employeeId).map((i) => ({ ...i, runId: r.id, month: r.month, status: r.status })));
  }

  @Get("payslips/:runId/:employeeId")
  async payslip(@CurrentSession() s: Session, @Param("runId") runId: string, @Param("employeeId") employeeId: string) {
    const slip = (await this.payslips(s, employeeId)).find((p) => p.runId === runId);
    if (!slip) throw new HttpError(404, "Payslip not found");
    return slip;
  }

  @Post("settlements/preview")
  async preview(@CurrentSession() s: Session, @Body() b: { employeeId: string; lastWorkingDay: string; separationType?: string; overtime?: number; bonus?: number; incentives?: number; otherAdditions?: number; noticeShortfallDays?: number; otherDeductions?: number }) {
    this.access.assertCan(s, "settlements", "create");
    const emp = await this.repo.get("employees", b.employeeId, { includeDeleted: true });
    if (!emp) throw new HttpError(404, "Employee not found");
    if (!b.lastWorkingDay) throw new HttpError(400, "lastWorkingDay is required");
    const sal = emp.salary as Salary;
    const daily = salaryTotal(sal) / 30, dailyBasic = sal.basic / 30;
    const settings = await this.access.settings<{ payroll?: { gratuityFirst5YearsDays?: number; gratuityAfter5YearsDays?: number } }>();
    const g = calcGratuity(sal.basic, emp.joiningDate, b.lastWorkingDay, { first5: settings.payroll?.gratuityFirst5YearsDays ?? 21, after5: settings.payroll?.gratuityAfter5YearsDays ?? 30 });
    const types = await this.repo.all("leaveTypes");
    const annual = leaveBalances(emp as never, types as unknown as LeaveTypeLite[], (await this.repo.find("leaves", { employeeId: emp.id })) as unknown as LeaveLite[], new Date(b.lastWorkingDay)).find((x) => x.name === "Annual Leave");
    const unused = Math.max(0, annual?.available ?? 0);
    const pendingDays = Number(b.lastWorkingDay.slice(8, 10));
    const loanBal = (await this.repo.find("loans", { employeeId: emp.id, status: "Active" })).reduce((t, l) => t + Number(l.balance), 0);
    const additions = [
      { label: "Pending salary", amount: Math.round(daily * pendingDays), note: `${pendingDays} day(s)` },
      { label: "Leave salary (unused annual leave)", amount: Math.round(dailyBasic * unused), note: `${unused} day(s) × basic daily rate` },
      { label: "End-of-service gratuity", amount: Math.round(g.amount), note: g.eligible ? `${g.gratuityDays.toFixed(1)} days' basic${g.capped ? " (capped)" : ""}` : "Not eligible (< 1 year)" },
      { label: "Overtime", amount: Number(b.overtime ?? 0) }, { label: "Bonus", amount: Number(b.bonus ?? 0) }, { label: "Incentives", amount: Number(b.incentives ?? 0) }, { label: "Other adjustments", amount: Number(b.otherAdditions ?? 0) },
    ].filter((l) => l.amount > 0 || l.label === "End-of-service gratuity");
    const deductions = [
      { label: "Outstanding loans & advances", amount: loanBal },
      { label: "Notice period shortfall", amount: Math.round(daily * Number(b.noticeShortfallDays ?? 0)) },
      { label: "Other deductions", amount: Number(b.otherDeductions ?? 0) },
    ].filter((l) => l.amount > 0);
    const gross = additions.reduce((t, l) => t + l.amount, 0), ded = deductions.reduce((t, l) => t + l.amount, 0);
    return { employeeId: emp.id, joiningDate: emp.joiningDate, lastWorkingDay: b.lastWorkingDay, reason: b.separationType ?? "Resignation", serviceYears: g.years, additions, deductions, gratuity: g, grossAmount: gross, totalDeductions: ded, netAmount: gross - ded };
  }

  @Get("expenses/reports/by-department")
  async expensesByDept(@CurrentSession() s: Session, @Query("from") from?: string, @Query("to") to?: string) {
    this.access.assertCan(s, "expenses", "export");
    return this.db.query(
      `SELECT d.name AS department, count(*)::int AS claims, sum(x.amount)::numeric AS total,
              sum(x.amount) FILTER (WHERE x.status = 'reimbursed')::numeric AS reimbursed, sum(x.amount) FILTER (WHERE x.status IN ('pending','manager_approved'))::numeric AS pending
       FROM expense_claims x JOIN employees e ON e.id = x.employee_id JOIN departments d ON d.id = e.department_id
       WHERE ($1::date IS NULL OR x.expense_date >= $1) AND ($2::date IS NULL OR x.expense_date <= $2) GROUP BY d.name ORDER BY total DESC`,
      [from || null, to || null],
    );
  }
}
