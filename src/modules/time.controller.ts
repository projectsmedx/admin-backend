import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from "@nestjs/common";
import { DbService } from "../database/db.service.js";
import { CurrentSession } from "../auth/auth.guard.js";
import { AccessService, HttpError, type Session } from "../domain/access.service.js";
import { Repo } from "../domain/repository.service.js";
import { leaveBalances, type LeaveLite, type LeaveTypeLite } from "../domain/hr.js";
import { dubaiNowHHMM, dubaiToday } from "./support.js";

const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

@Controller()
export class TimeController {
  constructor(private readonly db: DbService, private readonly repo: Repo, private readonly access: AccessService) {}

  // ----------------------------------------------------------------------- clock in / out
  @Get("attendance/today")
  async today(@CurrentSession() s: Session) {
    if (!s.employeeId) return null;
    return (await this.repo.find("attendance", { employeeId: s.employeeId, date: dubaiToday() }))[0] ?? null;
  }

  @Post("attendance/clock-in")
  @HttpCode(200)
  clockIn(@CurrentSession() s: Session, @Body() b: { method?: string; location?: string | null }) {
    return this.clock(s, "in", b ?? {});
  }

  @Post("attendance/clock-out")
  @HttpCode(200)
  clockOut(@CurrentSession() s: Session, @Body() b: { method?: string; location?: string | null }) {
    return this.clock(s, "out", b ?? {});
  }

  private async clock(s: Session, type: "in" | "out", b: { method?: string; location?: string | null }) {
    this.access.assertCan(s, "attendance", "create");
    if (!s.employeeId) throw new HttpError(400, "Your account isn't linked to an employee profile");
    const set = (await this.access.settings<{ attendance?: Record<string, any> }>()).attendance ?? {};
    if (set.requireGps && !b.location) throw new HttpError(400, "Location is required to check in");
    if (set.ipWhitelist && s.ip && !String(set.ipWhitelist).split(",").map((x: string) => x.trim()).filter(Boolean).includes(s.ip)) throw new HttpError(403, `Check-in is not allowed from IP ${s.ip}`);
    const date = dubaiToday(), time = dubaiNowHHMM();
    const method = b.method ?? "Web";
    return this.db.tx(async () => {
      const existing = (await this.repo.find("attendance", { employeeId: s.employeeId, date }))[0];
      if (type === "in") {
        if (existing?.checkIn) throw new HttpError(409, `Already checked in at ${existing.checkIn}`);
        const emp = await this.repo.get("employees", s.employeeId!);
        const shift = emp?.shiftId ? await this.repo.get("shifts", emp.shiftId) : undefined;
        const start = shift?.start ?? set.workStart ?? "09:00";
        const grace = Number(shift?.graceMinutes ?? set.graceMinutes ?? 15);
        const late = toMin(time) > toMin(start) + grace;
        const data = { employeeId: s.employeeId, date, checkIn: time, checkOut: null, status: late ? "Late" : emp?.workMode === "Remote" ? "Remote" : "Present", hours: 0, overtime: 0, method, location: b.location ?? null, ip: s.ip ?? null };
        const row = existing ? await this.repo.update("attendance", existing.id, data) : await this.repo.insert("attendance", data);
        await this.access.audit(s, "Checked In", "attendance", row!.id, { time, method });
        return row;
      }
      if (!existing?.checkIn) throw new HttpError(409, "You haven't checked in today");
      if (existing.checkOut) throw new HttpError(409, `Already checked out at ${existing.checkOut}`);
      const worked = Math.max(0, toMin(time) - toMin(existing.checkIn) - Number(set.breakMinutes ?? 60)) / 60;
      const hours = Math.round(worked * 100) / 100;
      const overtime = Math.max(0, Math.round((hours - Number(set.overtimeAfterHours ?? 8)) * 100) / 100);
      const status = hours < Number(set.halfDayHours ?? 4) ? "Half Day" : existing.status;
      const row = await this.repo.update("attendance", existing.id, { checkOut: time, hours, overtime, status });
      await this.access.audit(s, "Checked Out", "attendance", existing.id, { time, hours });
      return row;
    });
  }

  // ----------------------------------------------------------------------- register & reports
  @Get("attendance/register")
  async register(@CurrentSession() s: Session, @Query("month") month = dubaiToday().slice(0, 7), @Query("departmentId") departmentId?: string) {
    this.access.assertCan(s, "attendance", "view");
    const inScope = await this.access.scopePredicate(s, "attendance");
    const emps = (await this.repo.all("employees")).filter((e) => inScope(e.id) && (!departmentId || e.departmentId === departmentId) && !["Resigned", "Terminated"].includes(e.status));
    const att = await this.db.query<{ employee_id: string; d: string; status: string }>(
      "SELECT employee_id, work_date::text d, status::text FROM attendance_records WHERE to_char(work_date,'YYYY-MM') = $1 AND employee_id = ANY($2)",
      [month, emps.map((e) => e.id)],
    );
    const days = new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate();
    return {
      month,
      days: Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`),
      employees: emps.map((e) => {
        const mine = att.filter((a) => a.employee_id === e.id);
        return { id: e.id, code: e.code, name: e.name, days: Object.fromEntries(mine.map((a) => [a.d, a.status])), present: mine.filter((a) => ["present", "remote"].includes(a.status)).length, late: mine.filter((a) => a.status === "late").length, absent: mine.filter((a) => a.status === "absent").length };
      }),
    };
  }

  @Get("attendance/reports/:type")
  async report(@CurrentSession() s: Session, @Param("type") type: string, @Query("from") from?: string, @Query("to") to?: string) {
    this.access.assertCan(s, "attendance", "view");
    const inScope = await this.access.scopePredicate(s, "attendance");
    const f = from ?? new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10), t = to ?? dubaiToday();
    const rows = (await this.repo.all("attendance")).filter((a) => inScope(a.employeeId) && a.date >= f && a.date <= t);
    const pick: Record<string, (a: Record<string, any>) => boolean> = {
      late: (a) => a.status === "Late",
      overtime: (a) => Number(a.overtime) > 0,
      absence: (a) => a.status === "Absent",
      "missing-punch": (a) => !!a.checkIn && !a.checkOut && a.date < dubaiToday(),
      daily: () => true,
      monthly: () => true,
    };
    if (!pick[type]) throw new HttpError(404, `Unknown report "${type}". Use late, overtime, absence, missing-punch, daily or monthly.`);
    return rows.filter(pick[type]);
  }

  @Post("shifts/:id/assign")
  @HttpCode(200)
  async assignShift(@CurrentSession() s: Session, @Param("id") id: string, @Body() b: { employeeIds: string[]; effectiveFrom?: string }) {
    this.access.assertCan(s, "shifts", "edit");
    const shift = await this.repo.get("shifts", id);
    if (!shift) throw new HttpError(404, "Shift not found");
    await this.db.tx(async () => {
      for (const e of b.employeeIds ?? []) await this.repo.update("employees", e, { shiftId: id });
      await this.access.audit(s, "Shift Assigned", "shifts", id, { employees: b.employeeIds?.length ?? 0 });
    });
    return { ok: true, assigned: b.employeeIds?.length ?? 0 };
  }

  // ----------------------------------------------------------------------- branches
  /** PUT /locations/:id/employees { add?: string[], remove?: string[] } — assign employees to a branch. */
  @Put("locations/:id/employees")
  async assignToBranch(@CurrentSession() s: Session, @Param("id") id: string, @Body() b: { add?: string[]; remove?: string[] }) {
    this.access.assertCan(s, "employees", "edit");
    if (this.access.scopeOf(s.role, "employees") !== "all") throw new HttpError(403, "Only HR can assign employees to branches");
    const branch = await this.repo.get("locations", id);
    if (!branch) throw new HttpError(404, "Branch not found");
    const add = (b?.add ?? []).filter(Boolean), remove = (b?.remove ?? []).filter(Boolean);
    await this.db.tx(async () => {
      if (add.length) await this.db.query("UPDATE employees SET location_id = $1, updated_at = now() WHERE id = ANY($2) AND deleted_at IS NULL", [id, add]);
      if (remove.length) await this.db.query("UPDATE employees SET location_id = NULL, updated_at = now() WHERE id = ANY($2) AND location_id = $1", [id, remove]);
      await this.access.audit(s, "Branch Staff Updated", "locations", id, { branch: branch.name, added: add.length, removed: remove.length });
    });
    const staff = await this.db.query<{ id: string }>("SELECT id FROM employees WHERE location_id = $1 AND deleted_at IS NULL", [id]);
    return { ok: true, staff: staff.map((x) => x.id) };
  }

  // ----------------------------------------------------------------------- leave
  @Get("leave-balances")
  async balances(@CurrentSession() s: Session, @Query("employeeId") employeeId?: string, @Query("year") year?: string) {
    this.access.assertCan(s, "leaves", "view");
    const inScope = await this.access.scopePredicate(s, "leaves");
    const asOf = year ? new Date(`${year}-12-31T12:00:00`) : new Date();
    const [types, emps] = await Promise.all([this.repo.all("leaveTypes", { active: true }), this.repo.all("employees", employeeId ? { id: employeeId } : {})]);
    const scoped = emps.filter((e) => inScope(e.id) && !["Resigned", "Terminated"].includes(e.status));
    const leaves = await this.repo.all("leaves", { employeeId: scoped.map((e) => e.id) });
    const adj = await this.db.query<{ employee_id: string; leave_type_id: string; carried_forward: number; adjustment: number }>("SELECT * FROM leave_balances WHERE year = $1", [asOf.getFullYear()]);
    return scoped.map((e) => ({
      employeeId: e.id,
      name: e.name,
      balances: leaveBalances(e as never, types as unknown as LeaveTypeLite[], leaves as unknown as LeaveLite[], asOf).map((b) => {
        const a = adj.find((x) => x.employee_id === e.id && x.leave_type_id === b.leaveTypeId);
        if (!a) return b;
        const total = b.entitled + Number(a.carried_forward) + Number(a.adjustment);
        return { ...b, carried: Number(a.carried_forward), adjustment: Number(a.adjustment), total, available: Math.round((total - b.used - b.pending) * 10) / 10 };
      }),
    }));
  }

  @Post("leave-balances/adjust")
  @HttpCode(200)
  async adjust(@CurrentSession() s: Session, @Body() b: { employeeId: string; leaveTypeId: string; year?: number; adjustment: number; carriedForward?: number; note?: string }) {
    this.access.assertCan(s, "leaves", "approve");
    if (!this.access.isHR(s.role)) throw new HttpError(403, "Only HR can adjust balances");
    const year = b.year ?? new Date().getFullYear();
    const type = await this.repo.get("leaveTypes", b.leaveTypeId);
    if (!type) throw new HttpError(404, "Leave type not found");
    await this.db.query(
      `INSERT INTO leave_balances (employee_id, leave_type_id, year, entitled, carried_forward, adjustment, adjustment_note) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (employee_id, leave_type_id, year) DO UPDATE SET adjustment = EXCLUDED.adjustment, carried_forward = EXCLUDED.carried_forward, adjustment_note = EXCLUDED.adjustment_note, updated_at = now()`,
      [b.employeeId, b.leaveTypeId, year, type.daysPerYear, b.carriedForward ?? 0, Number(b.adjustment) || 0, b.note ?? null],
    );
    await this.access.audit(s, "Leave Balance Adjusted", "leaves", b.employeeId, b);
    return (await this.balances(s, b.employeeId, String(year)))[0];
  }

  @Get("leaves/calendar")
  async calendar(@CurrentSession() s: Session, @Query("month") month = dubaiToday().slice(0, 7), @Query("departmentId") departmentId?: string) {
    this.access.assertCan(s, "leaves", "view");
    const start = `${month}-01`, end = `${month}-31`;
    const leaves = (await this.access.filterByScope(s, "leaves", "leaves", await this.repo.all("leaves", { status: ["Pending", "Manager Approved", "Approved"] }))).filter((l) => l.from <= end && l.to >= start);
    const emps = new Map((await this.repo.all("employees")).map((e) => [e.id, e]));
    return {
      month,
      leaves: leaves.filter((l) => !departmentId || emps.get(l.employeeId)?.departmentId === departmentId).map((l) => ({ ...l, employeeName: emps.get(l.employeeId)?.name })),
      holidays: (await this.repo.all("holidays")).filter((h) => h.date >= start && h.date <= end),
    };
  }
}
