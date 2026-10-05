import { Injectable } from "@nestjs/common";
import { DbService } from "../database/db.service.js";
import { AccessService, type Session } from "../domain/access.service.js";
import { Repo } from "../domain/repository.service.js";
import { daysBetween, expiryStatus, isoDate, leaveBalances, type LeaveLite, type LeaveTypeLite, type PayrollItem } from "../domain/hr.js";
import { dubaiToday } from "./support.js";

const count = <T,>(rows: T[], key: (r: T) => string) => {
  const m = new Map<string, number>();
  rows.forEach((r) => m.set(key(r), (m.get(key(r)) ?? 0) + 1));
  return [...m.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
};

function daysToNext(dateStr: string, todayStr: string) {
  if (!dateStr || dateStr.includes("•")) return 999;
  const [, m, d] = dateStr.split("-").map(Number);
  const y = Number(todayStr.slice(0, 4));
  let next = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  if (next < todayStr) next = `${y + 1}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return daysBetween(todayStr, next);
}

/** Role-aware dashboard aggregation (org / team / self). */
@Injectable()
export class DashboardService {
  constructor(private readonly db: DbService, private readonly repo: Repo, private readonly access: AccessService) {}

  async build(s: Session) {
    const A = this.access;
    const todayStr = dubaiToday();
    const today = new Date(`${todayStr}T12:00:00`);
    const scope = A.scopeOf(s.role, "employees") ?? "own";
    const mode = scope === "all" ? "org" : scope === "team" ? "team" : "self";
    const inScope = await A.scopePredicate(s, "employees");
    const can = (r: Parameters<AccessService["can"]>[1], a: Parameters<AccessService["can"]>[2] = "view") => A.can(s.role, r, a);

    const allEmps = await this.repo.all("employees", {}, { includeDeleted: false });
    const emps = allEmps.filter((e) => inScope(e.id));
    const current = emps.filter((e) => !["Resigned", "Terminated"].includes(e.status));
    const ids = new Set(current.map((e) => e.id));
    const empIdList = [...ids];
    const [departments, locations, leaveTypesRows, leavesAll, runs, jobsAll, cands, holidays, reviews, exits, announcements] = await Promise.all([
      this.repo.all("departments"), this.repo.all("locations"), this.repo.all("leaveTypes"), this.repo.all("leaves", { employeeId: empIdList }),
      this.repo.all("payrollRuns"), this.repo.all("jobs", { status: "Open" }), this.repo.all("candidates"), this.repo.all("holidays"),
      this.repo.all("reviews", { employeeId: empIdList }), this.repo.all("offboarding"), this.repo.all("announcements", {}, { limit: 3 }),
    ]);
    const deptName = new Map(departments.map((d) => [d.id, d.name]));
    const locName = new Map(locations.map((l) => [l.id, l.name]));
    const empName = new Map(allEmps.map((e) => [e.id, e.name]));

    const from = new Date(Date.now() - 22 * 86400000).toISOString().slice(0, 10);
    const att = (await this.repo.all("attendance", { employeeId: empIdList })).filter((a) => a.date >= from);
    const attToday = att.filter((a) => a.date === todayStr);
    const onLeaveToday = leavesAll.filter((l) => l.status === "Approved" && l.from <= todayStr && l.to >= todayStr);
    const checkedIn = new Set(attToday.filter((a) => a.checkIn).map((a) => a.employeeId));
    const onLeaveIds = new Set(onLeaveToday.map((l) => l.employeeId));
    const absentToday = current.filter((e) => !checkedIn.has(e.id) && !onLeaveIds.has(e.id) && e.joiningDate <= todayStr).length;

    const [expensesP, correctionsP, revisionsP, timesheetsP] = await Promise.all([
      this.repo.all("expenses", { employeeId: empIdList, status: ["Pending", "Manager Approved"] }),
      this.repo.all("attendanceCorrections", { employeeId: empIdList, status: "Pending" }),
      this.repo.all("salaryRevisions", { employeeId: empIdList, status: "Pending" }),
      this.repo.all("timesheets", { employeeId: empIdList, status: "Submitted" }),
    ]);
    const notMe = (r: Record<string, any>) => r.employeeId !== s.employeeId;
    const pending = {
      leaves: leavesAll.filter((l) => notMe(l) && (l.status === "Pending" || (l.status === "Manager Approved" && can("leaves", "approve") && A.scopeOf(s.role, "leaves") === "all"))).length,
      expenses: expensesP.filter((x) => notMe(x) && (x.status === "Pending" || ["finance", "super_admin"].includes(s.role))).length,
      corrections: correctionsP.filter(notMe).length,
      salaryRevisions: revisionsP.length,
      timesheets: timesheetsP.filter(notMe).length,
    };
    const ap = (r: Parameters<AccessService["can"]>[1]) => can(r, "approve");
    const pendingApprovals = (ap("leaves") ? pending.leaves : 0) + (ap("expenses") ? pending.expenses : 0) + (ap("attendanceCorrections") ? pending.corrections : 0) + (ap("salaryRevisions") ? pending.salaryRevisions : 0) + (ap("timesheets") ? pending.timesheets : 0);

    const sortedRuns = [...runs].sort((a, b) => a.month.localeCompare(b.month));
    const latestRun = sortedRuns[sortedRuns.length - 1];
    const jobs = jobsAll.filter((j) => mode === "org" || j.hiringManagerId === s.employeeId);

    const birthdays = current.map((e) => ({ id: e.id, name: e.name, date: e.dateOfBirth, in: daysToNext(String(e.dateOfBirth ?? ""), todayStr), avatarColor: e.avatarColor, department: deptName.get(e.departmentId) })).filter((b) => b.in <= 30).sort((a, b) => a.in - b.in);
    const anniversaries = current
      .map((e) => ({ id: e.id, name: e.name, date: e.joiningDate, years: Number(todayStr.slice(0, 4)) - Number(String(e.joiningDate).slice(0, 4)) + (String(e.joiningDate).slice(5) < todayStr.slice(5) ? 1 : 0), in: daysToNext(String(e.joiningDate), todayStr), avatarColor: e.avatarColor }))
      .filter((a) => a.in <= 30 && a.years >= 1)
      .sort((a, b) => a.in - b.in);

    const wfh = leaveTypesRows.find((t) => t.code === "WFH")?.id;
    const kpis = {
      totalEmployees: emps.length,
      activeEmployees: current.filter((e) => ["Active", "Probation", "On Leave", "Notice Period"].includes(e.status)).length,
      newJoiners: current.filter((e) => { const d = daysBetween(e.joiningDate, todayStr); return d >= 0 && d <= 30; }).length,
      onLeave: onLeaveToday.length,
      absentToday,
      lateToday: attToday.filter((a) => a.status === "Late").length,
      remoteToday: attToday.filter((a) => a.status === "Remote").length + onLeaveToday.filter((l) => l.leaveTypeId === wfh).length,
      presentToday: checkedIn.size,
      probation: current.filter((e) => e.status === "Probation").length,
      leavingSoon: current.filter((e) => e.status === "Notice Period").length,
      openPositions: jobs.reduce((t, j) => t + Number(j.vacancies ?? 0), 0),
      pendingApprovals,
      payrollStatus: latestRun && A.scopeOf(s.role, "payrollRuns") === "all" ? { month: latestRun.month, status: latestRun.status, net: latestRun.totals?.net ?? null } : null,
      upcomingBirthdays: birthdays.length,
      workAnniversaries: anniversaries.length,
    };

    const byDate = new Map<string, Record<string, number | string>>();
    for (const a of att) {
      if (!byDate.has(a.date)) byDate.set(a.date, { date: a.date, Present: 0, Late: 0, Absent: 0, Remote: 0, "On Leave": 0 });
      const k = a.status === "Half Day" ? "Present" : a.status;
      const rec = byDate.get(a.date)!;
      if (k in rec) rec[k] = Number(rec[k]) + 1;
    }
    const attendanceTrend = [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(-14);

    const year = todayStr.slice(0, 4);
    const ltById = new Map(leaveTypesRows.map((t) => [t.id, t]));
    const leaveByType = count(leavesAll.filter((l) => l.status === "Approved" && l.from.startsWith(year)), (l) => ltById.get(l.leaveTypeId)?.name ?? "Other").map((x) => ({ ...x, color: leaveTypesRows.find((t) => t.name === x.name)?.color }));
    const payrollTrend = sortedRuns.map((r) => {
      const items = (r.items as PayrollItem[]).filter((i) => ids.has(i.employeeId));
      return { month: r.month, gross: items.reduce((t, i) => t + i.gross, 0), net: items.reduce((t, i) => t + i.net, 0), deductions: items.reduce((t, i) => t + i.deductions, 0) };
    });
    const stageOrder = ["Applied", "Screening", "Shortlisted", "Interview", "Technical Interview", "HR Interview", "Offer", "Hired"];
    const myCands = cands.filter((c) => mode === "org" || jobs.some((j) => j.id === c.jobId));
    const recruitmentPipeline = stageOrder.map((st) => ({ name: st, value: myCands.filter((c) => c.stage === st).length }));
    const upcomingHolidays = holidays.filter((h) => h.date >= todayStr).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 6);

    let expiring: Record<string, any>[] = [];
    if (can("documents")) {
      const docScope = await A.scopePredicate(s, "documents");
      const docs = await this.db.query<{ id: string; type: string; employee_id: string; expiry_date: string }>("SELECT id, type, employee_id, expiry_date::text FROM documents WHERE expiry_date IS NOT NULL AND expiry_date <= current_date + 90 AND employee_id = ANY($1)", [empIdList]);
      expiring = docs.filter((d) => docScope(d.employee_id)).map((d) => ({ id: d.id, type: d.type, employeeId: d.employee_id, employee: empName.get(d.employee_id), expiryDate: d.expiry_date, ...expiryStatus(d.expiry_date, today) })).filter((d) => ["expired", "critical", "warning"].includes(d.level)).sort((a, b) => (a.days ?? 0) - (b.days ?? 0));
    }

    const tasks: { title: string; link: string; count: number; tone: string }[] = [];
    if (ap("leaves") && pending.leaves) tasks.push({ title: "Leave requests awaiting approval", link: "/leave", count: pending.leaves, tone: "amber" });
    if (ap("expenses") && pending.expenses) tasks.push({ title: "Expense claims to review", link: "/expenses", count: pending.expenses, tone: "violet" });
    if (ap("attendanceCorrections") && pending.corrections) tasks.push({ title: "Attendance corrections", link: "/attendance", count: pending.corrections, tone: "sky" });
    if (ap("salaryRevisions") && pending.salaryRevisions) tasks.push({ title: "Salary revisions / promotions", link: "/performance/promotions", count: pending.salaryRevisions, tone: "emerald" });
    if (ap("timesheets") && pending.timesheets) tasks.push({ title: "Timesheets to approve", link: "/attendance/timesheets", count: pending.timesheets, tone: "indigo" });
    if (can("documents", "edit") && expiring.length) tasks.push({ title: "Documents expiring / expired", link: "/documents", count: expiring.length, tone: "rose" });
    if (ap("tickets")) {
      const open = Number((await this.db.one<{ c: number }>("SELECT count(*)::int c FROM tickets WHERE status='open'"))?.c ?? 0);
      if (open) tasks.push({ title: "Open helpdesk tickets", link: "/helpdesk", count: open, tone: "orange" });
    }
    if (can("onboarding", "edit") && mode === "org") {
      const n2 = Number((await this.db.one<{ c: number }>("SELECT count(*)::int c FROM onboarding_processes WHERE stage <> 'onboarding_complete'"))?.c ?? 0);
      if (n2) tasks.push({ title: "Onboarding in progress", link: "/onboarding", count: n2, tone: "teal" });
    }
    if (ap("payrollRuns") && latestRun?.status === "Draft") tasks.push({ title: `Approve ${latestRun.month} payroll`, link: "/payroll", count: 1, tone: "emerald" });

    const recentActivities = (await this.db.query<Record<string, any>>(
      `SELECT id, user_name AS "userName", action, entity, entity_id AS "entityId", changes->>'code' AS code, created_at AS "createdAt" FROM audit_logs
       WHERE action NOT IN ('Login','Logout','Login Failed') ${can("auditLogs") ? "" : "AND user_id = $1"} ORDER BY created_at DESC LIMIT 8`,
      can("auditLogs") ? [] : [s.userId],
    )).map((a) => ({ ...a, entityId: a.code ?? String(a.entityId ?? "").slice(0, 8), createdAt: new Date(a.createdAt).toISOString() }));

    const months: string[] = [];
    for (let k = 5; k >= 0; k--) {
      const d = new Date(today.getFullYear(), today.getMonth() - k, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
    const scopedIds = new Set(emps.map((e) => e.id));
    const turnover = months.map((m) => ({
      month: m,
      joiners: emps.filter((e) => e.joiningDate.startsWith(m)).length,
      exits: exits.filter((o) => String(o.lastWorkingDay).startsWith(m) && o.stage === "Completed" && scopedIds.has(o.employeeId)).length,
      headcount: emps.filter((e) => e.joiningDate <= `${m}-31` && !(e.status === "Resigned" && String(e.lastWorkingDay ?? "9999") < `${m}-01`)).length,
    }));
    const exitsYear = exits.filter((o) => String(o.lastWorkingDay).startsWith(year)).length;
    const doneReviews = reviews.filter((r) => r.finalRating != null);
    const fr = (r: Record<string, any>) => Number(r.finalRating);
    const ratingBands = [
      { name: "Outstanding (4.5+)", value: doneReviews.filter((r) => fr(r) >= 4.5).length },
      { name: "Exceeds (3.5–4.4)", value: doneReviews.filter((r) => fr(r) >= 3.5 && fr(r) < 4.5).length },
      { name: "Meets (2.5–3.4)", value: doneReviews.filter((r) => fr(r) >= 2.5 && fr(r) < 3.5).length },
      { name: "Below (<2.5)", value: doneReviews.filter((r) => fr(r) < 2.5).length },
    ];

    let me: Record<string, unknown> | null = null;
    if (s.employeeId) {
      const myEmp = allEmps.find((e) => e.id === s.employeeId);
      const lm = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const lastMonth = `${lm.getFullYear()}-${String(lm.getMonth() + 1).padStart(2, "0")}`;
      const myAtt = await this.repo.all("attendance", { employeeId: s.employeeId });
      const myLeaves = await this.repo.all("leaves", { employeeId: s.employeeId });
      const myRun = [...sortedRuns].reverse().find((r) => ["Approved", "Paid", "Locked"].includes(r.status) && (r.items as PayrollItem[]).some((i) => i.employeeId === s.employeeId));
      const [goals, myReviews, tickets, docs, onboarding] = await Promise.all([
        this.repo.all("goals", { ownerId: s.employeeId }), this.repo.all("reviews", { employeeId: s.employeeId }), this.repo.all("tickets", { employeeId: s.employeeId }),
        this.repo.all("documents", { employeeId: s.employeeId }), this.repo.all("onboarding", { employeeId: s.employeeId }),
      ]);
      me = {
        today: myAtt.find((a) => a.date === todayStr) ?? null,
        attendanceSummary: count(myAtt.filter((a) => a.date.startsWith(lastMonth)), (a) => a.status),
        attendanceMonth: lastMonth,
        leaveBalances: myEmp ? leaveBalances(myEmp as never, leaveTypesRows as unknown as LeaveTypeLite[], myLeaves as unknown as LeaveLite[], today).filter((b) => ["Annual Leave", "Sick Leave", "Work From Home", "Emergency Leave"].includes(b.name)) : [],
        latestPayslip: myRun ? { runId: myRun.id, month: myRun.month, status: myRun.status, ...(myRun.items as PayrollItem[]).find((i) => i.employeeId === s.employeeId) } : null,
        myLeaves: myLeaves.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 4),
        goals,
        reviews: myReviews.filter((r) => r.status !== "Completed"),
        tickets: tickets.filter((t) => !["Resolved", "Closed"].includes(t.status)),
        documents: docs.filter((d) => d.expiryDate).map((d) => ({ id: d.id, type: d.type, expiryDate: d.expiryDate, ...expiryStatus(d.expiryDate, today) })).filter((d) => d.level !== "ok"),
        onboarding: onboarding.find((o) => o.stage !== "Onboarding Complete") ?? null,
      };
    }

    return {
      mode,
      kpis,
      widgets: {
        byDepartment: count(current, (e) => deptName.get(e.departmentId) ?? "—"),
        byLocation: count(current, (e) => locName.get(e.locationId) ?? "—"),
        gender: count(current, (e) => e.gender || "Unspecified"),
        employmentType: count(current, (e) => e.employmentType),
        workMode: count(current, (e) => e.workMode),
        attendanceTrend,
        todayBreakdown: [
          { name: "Present", value: attToday.filter((a) => a.status === "Present").length },
          { name: "Late", value: kpis.lateToday },
          { name: "Remote", value: attToday.filter((a) => a.status === "Remote").length },
          { name: "On Leave", value: kpis.onLeave },
          { name: "Absent / Not in", value: absentToday },
        ],
        leaveByType,
        payrollTrend,
        recruitmentPipeline,
        upcomingHolidays,
        birthdays: birthdays.slice(0, 6),
        anniversaries: anniversaries.slice(0, 6),
        expiringDocuments: expiring.slice(0, 8),
        expiringCount: expiring.length,
        tasks,
        recentActivities,
        turnover,
        attritionRate: current.length ? Math.round((exitsYear / current.length) * 1000) / 10 : 0,
        ratingBands,
        avgRating: doneReviews.length ? Math.round((doneReviews.reduce((t, r) => t + fr(r), 0) / doneReviews.length) * 10) / 10 : null,
        announcements,
      },
      me,
    };
  }
}

export { isoDate };
