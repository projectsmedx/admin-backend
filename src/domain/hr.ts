// Pure HR calculations shared by server and client (no I/O).

export interface Salary {
  basic: number;
  housing: number;
  transport: number;
  medical: number;
  other: number;
}

export const salaryTotal = (s?: Partial<Salary> | null) =>
  s ? (s.basic ?? 0) + (s.housing ?? 0) + (s.transport ?? 0) + (s.medical ?? 0) + (s.other ?? 0) : 0;

export const DAY_MS = 86400000;

export function toDate(d: string | Date) {
  return typeof d === "string" ? new Date(`${d.slice(0, 10)}T00:00:00`) : d;
}

export function daysBetween(a: string | Date, b: string | Date) {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / DAY_MS);
}

export function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const isWeekend = (d: Date, weekend: number[] = [0, 6]) => weekend.includes(d.getDay());

export function workingDays(from: string, to: string, holidays: string[] = []) {
  const hs = new Set(holidays);
  let n = 0;
  for (let d = toDate(from); d <= toDate(to); d = new Date(d.getTime() + DAY_MS)) {
    if (!isWeekend(d) && !hs.has(isoDate(d))) n++;
  }
  return n;
}

// ---------------------------------------------------------------- UAE end-of-service gratuity
// Federal Decree-Law No. 33 of 2021: 21 days' basic wage per year for the first 5 years,
// 30 days per year after that, pro-rated for partial years, capped at 2 years' total wage.
// Requires at least one year of continuous service.
export function calcGratuity(basic: number, joiningDate: string, lastWorkingDay: string, opts = { first5: 21, after5: 30 }) {
  const serviceDays = Math.max(0, daysBetween(joiningDate, lastWorkingDay) + 1);
  const years = serviceDays / 365;
  const dailyWage = (basic * 12) / 365;
  if (years < 1) return { years, serviceDays, dailyWage, gratuityDays: 0, amount: 0, capped: false, eligible: false };
  const first = Math.min(years, 5) * opts.first5;
  const after = Math.max(0, years - 5) * opts.after5;
  const gratuityDays = first + after;
  let amount = gratuityDays * dailyWage;
  const cap = basic * 24;
  const capped = amount > cap;
  if (capped) amount = cap;
  return { years, serviceDays, dailyWage, gratuityDays, amount: Math.round(amount * 100) / 100, capped, eligible: true };
}

// ---------------------------------------------------------------- Leave balances
export interface LeaveTypeLite {
  id: string;
  name: string;
  daysPerYear: number;
  carryForward?: boolean;
  maxCarryForward?: number;
  color?: string;
  paid?: boolean;
}
export interface LeaveLite {
  employeeId: string;
  leaveTypeId: string;
  from: string;
  days: number;
  status: string;
}

export function leaveBalances(employee: { id: string; joiningDate: string }, types: LeaveTypeLite[], leaves: LeaveLite[], asOf = new Date()) {
  const year = asOf.getFullYear();
  const start = new Date(Math.max(new Date(`${year}-01-01T00:00:00`).getTime(), toDate(employee.joiningDate).getTime()));
  const monthsWorked = Math.max(0, (asOf.getFullYear() - start.getFullYear()) * 12 + asOf.getMonth() - start.getMonth() + 1);
  return types.map((t) => {
    const mine = leaves.filter((l) => l.employeeId === employee.id && l.leaveTypeId === t.id && l.from.startsWith(String(year)));
    const used = mine.filter((l) => l.status === "Approved").reduce((a, l) => a + l.days, 0);
    const pending = mine.filter((l) => l.status === "Pending" || l.status === "Manager Approved").reduce((a, l) => a + l.days, 0);
    // Annual leave accrues monthly; other types are granted up front
    const entitled = t.name === "Annual Leave" ? Math.min(t.daysPerYear, Math.round(monthsWorked * (t.daysPerYear / 12) * 10) / 10) : t.daysPerYear;
    const carried = t.carryForward ? Math.min(t.maxCarryForward ?? 0, 5) : 0;
    const total = entitled + carried;
    return { leaveTypeId: t.id, name: t.name, color: t.color, paid: t.paid, entitled, carried, total, used, pending, available: Math.round((total - used - pending) * 10) / 10 };
  });
}

// ---------------------------------------------------------------- Document expiry
export type ExpiryLevel = "expired" | "critical" | "warning" | "ok" | "none";
export function expiryStatus(expiryDate?: string | null, today = new Date()): { level: ExpiryLevel; days: number | null; label: string } {
  if (!expiryDate) return { level: "none", days: null, label: "No expiry" };
  const days = daysBetween(isoDate(today), expiryDate);
  if (days < 0) return { level: "expired", days, label: `Expired ${Math.abs(days)}d ago` };
  if (days <= 30) return { level: "critical", days, label: `Expires in ${days}d` };
  if (days <= 90) return { level: "warning", days, label: `Expires in ${days}d` };
  const label = days >= 365 ? `Valid ${Math.floor(days / 365)}y ${Math.round((days % 365) / 30)}m` : `Valid ${Math.round(days / 30)} months`;
  return { level: "ok", days, label };
}

// ---------------------------------------------------------------- Payroll line
export interface PayrollItem {
  employeeId: string;
  basic: number;
  housing: number;
  transport: number;
  medical: number;
  otherAllowances: number;
  overtimeHours: number;
  overtime: number;
  bonus: number;
  commission: number;
  unpaidLeaveDeduction: number;
  loanDeduction: number;
  otherDeductions: number;
  gross: number;
  deductions: number;
  net: number;
  workingDays?: number;
  paidDays?: number;
  absentDays?: number;
  unpaidLeaveDays?: number;
}

export function recomputeItem(i: PayrollItem): PayrollItem {
  const gross = i.basic + i.housing + i.transport + i.medical + i.otherAllowances + i.overtime + i.bonus + i.commission;
  const deductions = i.unpaidLeaveDeduction + i.loanDeduction + i.otherDeductions;
  return { ...i, gross: Math.round(gross), deductions: Math.round(deductions), net: Math.round(gross - deductions) };
}

export function payrollTotals(items: PayrollItem[]) {
  return items.reduce((t, i) => ({ gross: t.gross + i.gross, deductions: t.deductions + i.deductions, net: t.net + i.net }), { gross: 0, deductions: 0, net: 0 });
}
