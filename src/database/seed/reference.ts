// Company setup loaded into an empty database: branches, departments, designations, shifts,
// leave types, UAE holidays, settings and the onboarding checklist. No people — employees come from data/employees.json.
// Ids like "DEP-1" are only used to link these rows together while seeding.

/** UAE public holidays for a year. Islamic dates are approximate (≈11 days earlier each year) and should be confirmed by HR. */
function uaeHolidays(year: number) {
  const shift = (md: string) => {
    const d = new Date(Date.UTC(2026, Number(md.slice(0, 2)) - 1, Number(md.slice(3))));
    d.setUTCDate(d.getUTCDate() - Math.round((year - 2026) * 10.875));
    return d.toISOString().slice(0, 10);
  };
  const islamic = (name: string, md: string) => ({ name, date: shift(md), type: "Public", notes: "Subject to moon sighting / official announcement" });
  return [
    { name: "New Year's Day", date: `${year}-01-01`, type: "Public" },
    islamic("Eid Al Fitr", "03-20"), islamic("Eid Al Fitr Holiday", "03-21"), islamic("Eid Al Fitr Holiday", "03-22"),
    islamic("Arafah Day", "05-26"), islamic("Eid Al Adha", "05-27"), islamic("Eid Al Adha Holiday", "05-28"), islamic("Eid Al Adha Holiday", "05-29"),
    islamic("Islamic New Year", "06-16"), islamic("Prophet's Birthday", "08-25"),
    { name: "Company Foundation Day", date: `${year}-10-15`, type: "Company" },
    { name: "Commemoration Day", date: `${year}-12-01`, type: "Public" },
    { name: "UAE National Day", date: `${year}-12-02`, type: "Public" },
    { name: "UAE National Day Holiday", date: `${year}-12-03`, type: "Public" },
    { name: "Year-end Company Holiday", date: `${year}-12-31`, type: "Company" },
  ].map((h) => ({ notes: "", ...h, locationId: "All", country: "UAE", optional: false }));
}


export function reference(today: Date) {
  const ts = (d: Date) => d.toISOString();
  const locations = [
    { id: "LOC-1", name: "Dubai HQ", city: "Dubai", country: "UAE", address: "Business Bay, Dubai", timezone: "Asia/Dubai" },
    { id: "LOC-2", name: "Abu Dhabi Branch", city: "Abu Dhabi", country: "UAE", address: "Al Reem Island, Abu Dhabi", timezone: "Asia/Dubai" },
    { id: "LOC-3", name: "Sharjah Warehouse", city: "Sharjah", country: "UAE", address: "Industrial Area 6, Sharjah", timezone: "Asia/Dubai" },
  ];

  const deptDefs: [string, string, string, number, string][] = [
    ["DEP-1", "Executive", "EXE", 900000, "CC-100"],
    ["DEP-2", "Human Resources", "HR", 600000, "CC-200"],
    ["DEP-3", "Engineering", "ENG", 2400000, "CC-300"],
    ["DEP-4", "Finance", "FIN", 700000, "CC-400"],
    ["DEP-5", "Sales", "SAL", 1500000, "CC-500"],
    ["DEP-6", "Marketing", "MKT", 800000, "CC-600"],
    ["DEP-7", "Operations", "OPS", 1100000, "CC-700"],
    ["DEP-8", "Pharmacy", "PHA", 1300000, "CC-800"],
  ];
  const departments = deptDefs.map(([id, name, code, budget, costCenter]) => ({
    id, name, code, budget, costCenter, managerId: null, locationId: "LOC-1",
    description: `${name} department`, createdAt: ts(new Date("2020-01-01")),
  }));

  const desigDefs: [string, string, string, string, number, number][] = [
    // id, title, level, dept, min, max
    ["DES-1", "Chief Executive Officer", "L8", "DEP-1", 60000, 90000],
    ["DES-2", "HR Manager", "L6", "DEP-2", 25000, 35000],
    ["DES-3", "HR Executive", "L3", "DEP-2", 9000, 14000],
    ["DES-4", "Recruiter", "L3", "DEP-2", 8000, 13000],
    ["DES-5", "Chief Technology Officer", "L7", "DEP-3", 45000, 65000],
    ["DES-6", "Engineering Manager", "L6", "DEP-3", 30000, 40000],
    ["DES-7", "Senior Developer", "L5", "DEP-3", 20000, 28000],
    ["DES-8", "Developer", "L3", "DEP-3", 11000, 18000],
    ["DES-9", "QA Engineer", "L3", "DEP-3", 9000, 15000],
    ["DES-10", "Finance Manager", "L6", "DEP-4", 26000, 36000],
    ["DES-11", "Accountant", "L3", "DEP-4", 9000, 14000],
    ["DES-12", "Sales Manager", "L6", "DEP-5", 22000, 32000],
    ["DES-13", "Sales Executive", "L2", "DEP-5", 6000, 11000],
    ["DES-14", "Marketing Manager", "L6", "DEP-6", 22000, 30000],
    ["DES-15", "Marketing Specialist", "L3", "DEP-6", 8000, 13000],
    ["DES-16", "Operations Manager", "L6", "DEP-7", 22000, 30000],
    ["DES-17", "Operations Associate", "L2", "DEP-7", 5000, 9000],
    ["DES-18", "Pharmacist in Charge", "L5", "DEP-8", 18000, 26000],
    ["DES-19", "Pharmacist", "L3", "DEP-8", 11000, 16000],
    ["DES-20", "Pharmacy Assistant", "L1", "DEP-8", 4500, 7500],
    ["DES-21", "QA Manager", "L6", "DEP-3", 25000, 33000],
  ];
  const designations = desigDefs.map(([id, title, level, departmentId, minSalary, maxSalary]) => ({
    id, title, level, departmentId, minSalary, maxSalary,
    description: `Responsible for ${title.toLowerCase()} duties.`,
    skills: [],
  }));


  const shifts = [
    { id: "SH-1", name: "Morning", type: "Morning", start: "09:00", end: "18:00", breakMinutes: 60, graceMinutes: 15, days: "Mon-Fri", color: "#6366f1" },
    { id: "SH-2", name: "Evening", type: "Evening", start: "14:00", end: "23:00", breakMinutes: 60, graceMinutes: 10, days: "Mon-Fri", color: "#f59e0b" },
    { id: "SH-3", name: "Night", type: "Night", start: "22:00", end: "07:00", breakMinutes: 45, graceMinutes: 10, days: "Mon-Sat", color: "#0ea5e9" },
    { id: "SH-4", name: "Flexible", type: "Flexible", start: "08:00", end: "17:00", breakMinutes: 60, graceMinutes: 60, days: "Mon-Fri", color: "#10b981" },
    { id: "SH-5", name: "Pharmacy Rotational", type: "Rotational", start: "08:00", end: "20:00", breakMinutes: 60, graceMinutes: 10, days: "Rotating", color: "#ec4899" },
  ];

  const holidays = uaeHolidays(today.getUTCFullYear()).concat(uaeHolidays(today.getUTCFullYear() + 1)).map((h, i) => ({ ...h, id: `HOL-${i + 1}` }));

  const leaveTypes = [
    { id: "LT-1", name: "Annual Leave", code: "AL", daysPerYear: 30, paid: true, carryForward: true, maxCarryForward: 10, color: "#6366f1", requiresDocument: false },
    { id: "LT-2", name: "Sick Leave", code: "SL", daysPerYear: 15, paid: true, carryForward: false, maxCarryForward: 0, color: "#f43f5e", requiresDocument: true },
    { id: "LT-3", name: "Emergency Leave", code: "EL", daysPerYear: 5, paid: true, carryForward: false, maxCarryForward: 0, color: "#f97316", requiresDocument: false },
    { id: "LT-4", name: "Unpaid Leave", code: "UL", daysPerYear: 30, paid: false, carryForward: false, maxCarryForward: 0, color: "#64748b", requiresDocument: false },
    { id: "LT-5", name: "Maternity Leave", code: "ML", daysPerYear: 60, paid: true, carryForward: false, maxCarryForward: 0, color: "#ec4899", requiresDocument: true },
    { id: "LT-6", name: "Paternity Leave", code: "PL", daysPerYear: 5, paid: true, carryForward: false, maxCarryForward: 0, color: "#0ea5e9", requiresDocument: false },
    { id: "LT-7", name: "Bereavement Leave", code: "BL", daysPerYear: 5, paid: true, carryForward: false, maxCarryForward: 0, color: "#475569", requiresDocument: false },
    { id: "LT-8", name: "Work From Home", code: "WFH", daysPerYear: 24, paid: true, carryForward: false, maxCarryForward: 0, color: "#14b8a6", requiresDocument: false },
    { id: "LT-9", name: "Compensatory Leave", code: "CL", daysPerYear: 10, paid: true, carryForward: false, maxCarryForward: 0, color: "#8b5cf6", requiresDocument: false },
  ];

  const onboardingTemplate: [string, string, string][] = [
    ["Offer letter signed", "Documents", "HR"], ["Employment contract signed", "Documents", "HR"], ["Personal information submitted", "Employee", "Employee"],
    ["Passport & Emirates ID uploaded", "Documents", "Employee"], ["Bank details (IBAN) provided", "Employee", "Employee"], ["Emergency contact added", "Employee", "Employee"],
    ["Visa & work permit processed", "Documents", "HR"], ["Health insurance enrolled", "HR", "HR"], ["Laptop allocated", "IT", "IT"],
    ["Email account created", "IT", "IT"], ["System access granted", "IT", "IT"], ["ID card issued", "Admin", "HR"],
    ["Team introduction", "Manager", "Manager"], ["HR orientation", "HR", "HR"], ["Department orientation", "Manager", "Manager"],
  ];

  const settings = {
    id: "settings",
    company: { name: "MedX Pharmacy LLC", legalName: "MedX Pharmacy L.L.C", tradeLicense: "DED-784512", trn: "100458796300003", email: "hr@medxpharmacy.com", phone: "+971 4 555 0100", website: "https://medxpharmacy.com", address: "Bay Square, Business Bay, Dubai, UAE", currency: "AED", timezone: "Asia/Dubai", weekend: ["Saturday", "Sunday"], molEstablishmentId: "1234567", fiscalYearStart: "01-01" },
    hr: { probationMonths: 6, noticePeriodDays: 30, employmentTypes: ["Full-time", "Part-time", "Contract", "Intern"], employeeIdPrefix: "EMP-" },
    attendance: { workStart: "09:00", workEnd: "18:00", graceMinutes: 15, lateThresholdMinutes: 15, halfDayHours: 4, fullDayHours: 8, breakMinutes: 60, overtimeAfterHours: 8, allowWebCheckIn: true, allowMobileCheckIn: true, requireGps: false, ipWhitelist: "" },
    leave: { accrualMethod: "Monthly", carryForwardCap: 10, allowHalfDay: true, allowNegativeBalance: false, approvalFlow: ["manager", "hr"] },
    payroll: { payDay: 28, overtimeRate: 1.25, holidayOvertimeRate: 1.5, wpsEnabled: true, wpsBankCode: "EBILAEAD", gratuityFirst5YearsDays: 21, gratuityAfter5YearsDays: 30, payrollPeriod: "Monthly" },
    notifications: { email: true, sms: false, push: true, whatsapp: false, documentExpiryReminderDays: [90, 60, 30, 7], birthdayWishes: true, payrollCompletion: true },
    security: { passwordMinLength: 8, sessionTimeoutMinutes: 480, maxFailedAttempts: 5, lockoutMinutes: 15, enforceMfa: false, maskSensitiveFields: true },
    workflow: { leave: ["manager", "hr"], expenses: ["manager", "finance"], recruitment: ["hiring_manager", "hr"], salaryRevision: ["hr", "finance"] },
  };

  return { locations, departments, designations, shifts, holidays, leaveTypes, settings, onboardingTemplate };
}
