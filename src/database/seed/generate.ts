// @ts-nocheck — demo data generator ported from scripts/seed.mjs (plain JS objects)
// Generates the same demo organization relative to `today` so the data always looks current.
import bcrypt from "bcryptjs";

const PASSWORD = "Password@123";
const ANCHOR = Date.parse("2026-10-01T00:00:00Z");

/** UAE public holidays for a year. Islamic dates are approximate (≈11 days earlier each year) and should be confirmed by HR. */
function uaeHolidays(year) {
  const shift = (md, n) => {
    const d = new Date(Date.UTC(2026, Number(md.slice(0, 2)) - 1, Number(md.slice(3))));
    d.setUTCDate(d.getUTCDate() - Math.round((year - 2026) * 10.875));
    return d.toISOString().slice(0, 10);
  };
  const islamic = (name, md) => ({ name, date: shift(md), type: "Public", notes: "Subject to moon sighting / official announcement" });
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

export function generate(TODAY = new Date()) {
  TODAY = new Date(Date.UTC(TODAY.getUTCFullYear(), TODAY.getUTCMonth(), TODAY.getUTCDate(), 5, 0, 0));
  const Y = TODAY.getUTCFullYear();
  const LAST_MONTH = new Date(Date.UTC(Y, TODAY.getUTCMonth() - 1, 1));
  const LM_NAME = LAST_MONTH.toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
  const LM_KEY = LAST_MONTH.toISOString().slice(0, 7);
  const QUARTER = `Q${Math.floor(LAST_MONTH.getUTCMonth() / 3) + 1} ${LAST_MONTH.getUTCFullYear()}`;
  const HALF = TODAY.getUTCMonth() >= 6 ? `H1 ${Y}` : `H2 ${Y - 1}`;
  const NEXT_HALF = TODAY.getUTCMonth() >= 6 ? `H2 ${Y}` : `H1 ${Y}`;
  const DELTA = Math.round((Date.parse(TODAY.toISOString().slice(0, 10)) - ANCHOR) / 86400000);
  /** Shifts a date literal written for the 2026-10-01 anchor so it keeps the same distance from today. */
  const fx = (s) => {
    const d = new Date(s.length === 10 ? `${s}T00:00:00Z` : s);
    d.setUTCDate(d.getUTCDate() + DELTA);
    return s.length === 10 ? d.toISOString().slice(0, 10) : d.toISOString();
  };

  const PASSWORD = "Password@123";
  
  let seed = 42;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const int = (min, max) => Math.floor(rand() * (max - min + 1)) + min;
  const pad = (n, l = 2) => String(n).padStart(l, "0");
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (d, n) => {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  };
  const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6; // UAE weekend: Sat/Sun
  const ts = (d) => d.toISOString();
  
  
  // ---------------------------------------------------------------- Locations
  const locations = [
    { id: "LOC-1", name: "Dubai HQ", city: "Dubai", country: "UAE", address: "Business Bay, Dubai", timezone: "Asia/Dubai" },
    { id: "LOC-2", name: "Abu Dhabi Branch", city: "Abu Dhabi", country: "UAE", address: "Al Reem Island, Abu Dhabi", timezone: "Asia/Dubai" },
    { id: "LOC-3", name: "Sharjah Warehouse", city: "Sharjah", country: "UAE", address: "Industrial Area 6, Sharjah", timezone: "Asia/Dubai" },
  ];
  
  // ---------------------------------------------------------------- Departments & designations
  const deptDefs = [
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
  
  const desigDefs = [
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
  
  // ---------------------------------------------------------------- Shifts
  const shifts = [
    { id: "SH-1", name: "Morning", type: "Morning", start: "09:00", end: "18:00", breakMinutes: 60, graceMinutes: 15, days: "Mon-Fri", color: "#6366f1" },
    { id: "SH-2", name: "Evening", type: "Evening", start: "14:00", end: "23:00", breakMinutes: 60, graceMinutes: 10, days: "Mon-Fri", color: "#f59e0b" },
    { id: "SH-3", name: "Night", type: "Night", start: "22:00", end: "07:00", breakMinutes: 45, graceMinutes: 10, days: "Mon-Sat", color: "#0ea5e9" },
    { id: "SH-4", name: "Flexible", type: "Flexible", start: "08:00", end: "17:00", breakMinutes: 60, graceMinutes: 60, days: "Mon-Fri", color: "#10b981" },
    { id: "SH-5", name: "Pharmacy Rotational", type: "Rotational", start: "08:00", end: "20:00", breakMinutes: 60, graceMinutes: 10, days: "Rotating", color: "#ec4899" },
  ];
  
  // ---------------------------------------------------------------- Employees
  const maleFirst = ["Ahmed", "Mohammed", "Omar", "Khalid", "Rashid", "Yousef", "Hamza", "Ali", "Rahul", "Arjun", "Daniel", "James", "Faisal", "Imran", "Karim", "Tariq", "Vikram", "Joseph", "Samir", "Nabil"];
  const femaleFirst = ["Fatima", "Aisha", "Mariam", "Noura", "Sara", "Layla", "Priya", "Anjali", "Emily", "Sophia", "Hessa", "Reem", "Zainab", "Leena", "Grace", "Maria", "Dana", "Huda", "Salma", "Meera"];
  const lastNames = ["Al Mansoori", "Al Hashimi", "Khan", "Sharma", "Al Nuaimi", "Haddad", "Fernandes", "Nair", "Smith", "Rahman", "Qureshi", "Al Suwaidi", "Menon", "Saleh", "Ibrahim", "Ali", "Thomas", "Hussain", "Al Zaabi", "Kapoor"];
  const nationalities = ["UAE", "India", "Pakistan", "Egypt", "Philippines", "Jordan", "United Kingdom", "Lebanon", "Syria", "Sri Lanka"];
  const banks = ["Emirates NBD", "ADCB", "FAB", "Mashreq", "Dubai Islamic Bank", "RAKBANK"];
  const avatarColors = ["#6366f1", "#8b5cf6", "#ec4899", "#f43f5e", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#0ea5e9", "#3b82f6"];
  
  const employees = [];
  let empNo = 1001;
  function makeEmployee({ designationId, managerId, gender, first, last, joining, status, employmentType, workMode, locationId, email }) {
    const des = designations.find((d) => d.id === designationId);
    gender = gender || (rand() > 0.5 ? "Male" : "Female");
    first = first || pick(gender === "Male" ? maleFirst : femaleFirst);
    last = last || pick(lastNames);
    const id = `EMP-${empNo++}`;
    const basic = Math.round((des.minSalary + rand() * (des.maxSalary - des.minSalary)) * 0.6 / 100) * 100;
    const joinDate = joining || iso(addDays(TODAY, -int(40, 3200)));
    const probationEnd = iso(addDays(new Date(joinDate), 180));
    const onProbation = new Date(probationEnd) > TODAY;
    const dob = iso(new Date(int(1972, 2001), int(0, 11), int(1, 28)));
    const nat = pick(nationalities);
    const e = {
      id,
      firstName: first,
      lastName: last,
      name: `${first} ${last}`,
      email: email || `${first}.${last.replace(/\s+/g, "")}${empNo}@medxpharmacy.com`.toLowerCase(),
      personalEmail: `${first}.${int(10, 99)}@gmail.com`.toLowerCase(),
      phone: `+971 5${int(0, 8)} ${int(100, 999)} ${int(1000, 9999)}`,
      gender,
      dateOfBirth: dob,
      nationality: nat,
      maritalStatus: pick(["Single", "Married", "Married", "Single", "Divorced"]),
      address: `${pick(["Al Barsha", "JLT", "Deira", "Al Nahda", "Karama", "Al Qusais", "Downtown", "Khalidiya"])}, ${pick(["Dubai", "Dubai", "Abu Dhabi", "Sharjah"])}`,
      emergencyContact: { name: `${pick(maleFirst)} ${last}`, relation: pick(["Spouse", "Brother", "Father", "Sister", "Mother"]), phone: `+971 5${int(0, 8)} ${int(100, 999)} ${int(1000, 9999)}` },
      designationId,
      departmentId: des.departmentId,
      managerId: managerId || null,
      locationId: locationId || pick(["LOC-1", "LOC-1", "LOC-1", "LOC-2", "LOC-3"]),
      shiftId: des.departmentId === "DEP-8" ? "SH-5" : pick(["SH-1", "SH-1", "SH-1", "SH-4"]),
      employmentType: employmentType || pick(["Full-time", "Full-time", "Full-time", "Full-time", "Contract", "Part-time"]),
      workMode: workMode || pick(["Office", "Office", "Office", "Hybrid", "Remote"]),
      joiningDate: joinDate,
      probationEndDate: probationEnd,
      confirmationDate: onProbation ? null : probationEnd,
      status: status || (onProbation ? "Probation" : "Active"),
      salary: {
        basic,
        housing: Math.round(basic * 0.4 / 100) * 100,
        transport: Math.round(basic * 0.1 / 100) * 100,
        medical: 500,
        other: pick([0, 0, 500, 1000]),
      },
      bank: { name: pick(banks), iban: `AE${int(10, 99)}0${int(10, 99)}000${int(1000000000, 9999999999)}${int(100, 999)}`, routingCode: `${int(100000000, 999999999)}` },
      emiratesId: `784-${int(1970, 2001)}-${int(1000000, 9999999)}-${int(1, 9)}`,
      passportNumber: `${pick(["N", "P", "Z", "K"])}${int(1000000, 9999999)}`,
      laborCardNumber: `${int(10000000, 99999999)}`,
      skills: [],
      avatarColor: pick(avatarColors),
      noticePeriodDays: 30,
      createdAt: ts(new Date(joinDate)),
    };
    employees.push(e);
    return e;
  }
  
  // Fixed leadership (named demo accounts map to these)
  const ceo = makeEmployee({ designationId: "DES-1", first: "Khalid", last: "Al Mansoori", gender: "Male", joining: "2018-02-11", status: "Active", employmentType: "Full-time", workMode: "Office", locationId: "LOC-1", email: "ceo@medxpharmacy.com" });
  const hrm = makeEmployee({ designationId: "DES-2", managerId: ceo.id, first: "Fatima", last: "Al Hashimi", gender: "Female", joining: "2019-04-01", status: "Active", employmentType: "Full-time", workMode: "Office", locationId: "LOC-1", email: "hr.manager@medxpharmacy.com" });
  const hra = makeEmployee({ designationId: "DES-3", managerId: hrm.id, first: "Sara", last: "Haddad", gender: "Female", joining: "2021-06-13", status: "Active", employmentType: "Full-time", workMode: "Office", locationId: "LOC-1", email: "hr.admin@medxpharmacy.com" });
  makeEmployee({ designationId: "DES-4", managerId: hrm.id, first: "Priya", last: "Nair", gender: "Female", joining: "2022-09-05", status: "Active" });
  const cto = makeEmployee({ designationId: "DES-5", managerId: ceo.id, first: "Daniel", last: "Smith", gender: "Male", joining: "2019-01-20", status: "Active", employmentType: "Full-time", workMode: "Hybrid" });
  const engm = makeEmployee({ designationId: "DES-6", managerId: cto.id, first: "Omar", last: "Rahman", gender: "Male", joining: "2020-03-15", status: "Active", employmentType: "Full-time", workMode: "Hybrid", locationId: "LOC-1", email: "manager@medxpharmacy.com" });
  const qam = makeEmployee({ designationId: "DES-21", managerId: cto.id, first: "Leena", last: "Menon", gender: "Female", joining: "2020-11-02", status: "Active" });
  const finm = makeEmployee({ designationId: "DES-10", managerId: ceo.id, first: "Rashid", last: "Al Suwaidi", gender: "Male", joining: "2019-07-07", status: "Active", employmentType: "Full-time", workMode: "Office", locationId: "LOC-1", email: "finance@medxpharmacy.com" });
  const salm = makeEmployee({ designationId: "DES-12", managerId: ceo.id, first: "Karim", last: "Saleh", gender: "Male", joining: "2020-05-10", status: "Active" });
  const mktm = makeEmployee({ designationId: "DES-14", managerId: ceo.id, first: "Emily", last: "Thomas", gender: "Female", joining: "2021-02-01", status: "Active" });
  const opsm = makeEmployee({ designationId: "DES-16", managerId: ceo.id, first: "Tariq", last: "Hussain", gender: "Male", joining: "2019-10-14", status: "Active", locationId: "LOC-3" });
  const pham = makeEmployee({ designationId: "DES-18", managerId: ceo.id, first: "Aisha", last: "Ibrahim", gender: "Female", joining: "2019-03-03", status: "Active" });
  
  // Named self-service demo employee reporting to the engineering manager
  makeEmployee({ designationId: "DES-8", managerId: engm.id, first: "Ahmed", last: "Khan", gender: "Male", joining: "2023-08-20", status: "Active", employmentType: "Full-time", workMode: "Office", locationId: "LOC-1", email: "employee@medxpharmacy.com" });
  
  const teamPlan = [
    ["DES-7", engm.id, 4], ["DES-8", engm.id, 6], ["DES-9", qam.id, 3],
    ["DES-11", finm.id, 3], ["DES-13", salm.id, 6], ["DES-15", mktm.id, 3],
    ["DES-17", opsm.id, 5], ["DES-19", pham.id, 5], ["DES-20", pham.id, 4], ["DES-3", hrm.id, 1],
  ];
  for (const [des, mgr, count] of teamPlan) for (let i = 0; i < count; i++) makeEmployee({ designationId: des, managerId: mgr });
  
  // Some non-standard statuses for realism
  employees[30].status = "Notice Period";
  employees[41].status = "On Leave";
  employees[47].status = "Resigned";
  employees[47].lastWorkingDay = fx("2026-08-31");
  // A few very recent joiners
  employees.slice(-3).forEach((e, i) => {
    e.joiningDate = iso(addDays(TODAY, -int(3, 25) - i));
    e.probationEndDate = iso(addDays(new Date(e.joiningDate), 180));
    e.confirmationDate = null;
    e.status = "Probation";
  });
  
  const dept = (id) => departments.find((d) => d.id === id);
  dept("DEP-1").managerId = ceo.id;
  dept("DEP-2").managerId = hrm.id;
  dept("DEP-3").managerId = cto.id;
  dept("DEP-4").managerId = finm.id;
  dept("DEP-5").managerId = salm.id;
  dept("DEP-6").managerId = mktm.id;
  dept("DEP-7").managerId = opsm.id;
  dept("DEP-8").managerId = pham.id;
  dept("DEP-7").locationId = "LOC-3";
  
  const skillPool = { "DEP-3": ["React", "Node.js", "TypeScript", "AWS", "Python", "SQL", "Docker"], "DEP-8": ["Dispensing", "DHA License", "Inventory", "Patient Counselling"], "DEP-5": ["B2B Sales", "CRM", "Negotiation"], "DEP-6": ["SEO", "Content", "Paid Ads"], "DEP-4": ["IFRS", "VAT", "Excel", "Tally"], "DEP-2": ["Recruitment", "UAE Labour Law", "Payroll"], "DEP-7": ["Logistics", "Warehouse", "SAP"], "DEP-1": ["Leadership", "Strategy"] };
  employees.forEach((e) => {
    const pool = skillPool[e.departmentId] || [];
    e.skills = [...new Set([pick(pool), pick(pool), pick(pool)])].filter(Boolean);
  });
  designations.forEach((d) => (d.skills = (skillPool[d.departmentId] || []).slice(0, 3)));
  
  const active = employees.filter((e) => e.status !== "Resigned");
  
  // ---------------------------------------------------------------- Users (auth)
  const hash = bcrypt.hashSync(PASSWORD, 10);
  const users = [
    { id: "USR-1", email: "admin@medxpharmacy.com", name: "System Administrator", role: "super_admin", employeeId: ceo.id },
    { id: "USR-2", email: "hr.admin@medxpharmacy.com", name: hra.name, role: "hr_admin", employeeId: hra.id },
    { id: "USR-3", email: "hr.manager@medxpharmacy.com", name: hrm.name, role: "hr_manager", employeeId: hrm.id },
    { id: "USR-4", email: "finance@medxpharmacy.com", name: finm.name, role: "finance", employeeId: finm.id },
    { id: "USR-5", email: "manager@medxpharmacy.com", name: engm.name, role: "manager", employeeId: engm.id },
    { id: "USR-6", email: "employee@medxpharmacy.com", name: "Ahmed Khan", role: "employee", employeeId: employees.find((e) => e.email === "employee@medxpharmacy.com").id },
  ].map((u) => ({ ...u, passwordHash: hash, active: true, failedAttempts: 0, lockedUntil: null, lastLoginAt: null, mfaEnabled: false, createdAt: ts(new Date("2024-01-01")) }));
  // Every other manager gets a manager login, everyone else an employee login
  let uid = 7;
  for (const e of employees) {
    if (users.some((u) => u.employeeId === e.id) || e.status === "Resigned") continue;
    const isMgr = employees.some((x) => x.managerId === e.id);
    users.push({ id: `USR-${uid++}`, email: e.email, name: e.name, role: isMgr ? "manager" : "employee", employeeId: e.id, passwordHash: hash, active: true, failedAttempts: 0, lockedUntil: null, lastLoginAt: null, mfaEnabled: false, createdAt: e.createdAt });
  }
  
  // ---------------------------------------------------------------- Holidays (UAE 2026; Islamic dates are estimates and editable)
  const holidays = uaeHolidays(TODAY.getFullYear()).concat(uaeHolidays(TODAY.getFullYear() + 1)).map((h, i) => ({ ...h, id: `HOL-${i + 1}` }));
  const holidaySet = new Set(holidays.map((h) => h.date));
  
  // ---------------------------------------------------------------- Leave types & leaves
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
  
  const workingDaysBetween = (from, to) => {
    let n = 0;
    for (let d = new Date(from); d <= new Date(to); d = addDays(d, 1)) if (!isWeekend(d) && !holidaySet.has(iso(d))) n++;
    return n;
  };
  
  const leaves = [];
  let lv = 1;
  const leaveReasons = ["Family vacation", "Feeling unwell", "Personal work", "Travel to home country", "Medical appointment", "Family function", "Child care", "Home maintenance"];
  for (let i = 0; i < 70; i++) {
    const e = pick(active);
    const type = pick(["LT-1", "LT-1", "LT-1", "LT-2", "LT-2", "LT-3", "LT-8", "LT-8", "LT-4"]);
    let start = addDays(TODAY, int(-150, 45));
    while (isWeekend(start)) start = addDays(start, 1);
    const len = type === "LT-1" ? int(1, 10) : int(1, 3);
    const end = addDays(start, len - 1);
    const past = end < TODAY;
    const status = past ? pick(["Approved", "Approved", "Approved", "Approved", "Rejected"]) : pick(["Pending", "Pending", "Manager Approved", "Approved", "Approved"]);
    const created = addDays(start, -int(2, 20));
    leaves.push({
      id: `LV-${lv++}`, employeeId: e.id, leaveTypeId: type, from: iso(start), to: iso(end),
      days: Math.max(1, workingDaysBetween(start, end)), halfDay: false, reason: pick(leaveReasons), status,
      approvals: status === "Pending" ? [] : [{ by: e.managerId, role: "manager", action: status === "Rejected" ? "Rejected" : "Approved", at: ts(addDays(created, 1)), comment: "" }],
      attachment: type === "LT-2" ? "medical-certificate.pdf" : null, createdAt: ts(created),
    });
  }
  // Guaranteed items in the demo employee's/manager's queue
  const demoEmp = employees.find((e) => e.email === "employee@medxpharmacy.com");
  leaves.push({ id: `LV-${lv++}`, employeeId: demoEmp.id, leaveTypeId: "LT-1", from: fx("2026-10-12"), to: fx("2026-10-16"), days: 5, halfDay: false, reason: "Family trip", status: "Pending", approvals: [], attachment: null, createdAt: ts(addDays(TODAY, -2)) });
  leaves.push({ id: `LV-${lv++}`, employeeId: demoEmp.id, leaveTypeId: "LT-2", from: fx("2026-07-07"), to: fx("2026-07-08"), days: 2, halfDay: false, reason: "Fever", status: "Approved", approvals: [{ by: engm.id, role: "manager", action: "Approved", at: fx("2026-07-07T08:00:00.000Z"), comment: "Get well soon" }], attachment: "medical-certificate.pdf", createdAt: fx("2026-07-07T06:00:00.000Z") });
  // Today's leave for one employee so "on leave today" shows up
  leaves.push({ id: `LV-${lv++}`, employeeId: employees[41].id, leaveTypeId: "LT-1", from: fx("2026-09-24"), to: fx("2026-10-08"), days: 11, halfDay: false, reason: "Annual vacation", status: "Approved", approvals: [], attachment: null, createdAt: fx("2026-09-01T06:00:00.000Z") });
  
  // ---------------------------------------------------------------- Attendance (last 45 days)
  const onLeave = (empId, dateStr) => leaves.some((l) => l.employeeId === empId && l.status === "Approved" && l.from <= dateStr && l.to >= dateStr);
  const attendance = [];
  let at = 1;
  for (let back = 45; back >= 0; back--) {
    const d = addDays(TODAY, -back);
    const ds = iso(d);
    if (isWeekend(d) || holidaySet.has(ds)) continue;
    for (const e of active) {
      if (e.joiningDate > ds) continue;
      if (back === 0 && rand() < 0.12) continue; // not checked in yet today
      let status = "Present", checkIn = null, checkOut = null, hours = 0, overtime = 0;
      const method = e.workMode === "Remote" ? "Web" : pick(["Biometric", "Biometric", "Mobile", "Web", "QR"]);
      if (onLeave(e.id, ds)) status = "On Leave";
      else {
        const r = rand();
        if (r < 0.04) status = "Absent";
        else {
          const lateMin = r < 0.14 ? int(16, 70) : int(-20, 12);
          const inMin = 9 * 60 + lateMin;
          const stay = r > 0.95 ? int(240, 300) : int(500, 620);
          checkIn = `${pad(Math.floor(inMin / 60))}:${pad(inMin % 60)}`;
          if (back !== 0) {
            const outMin = inMin + stay;
            checkOut = `${pad(Math.floor(outMin / 60))}:${pad(outMin % 60)}`;
            hours = Math.round(((stay - 60) / 60) * 100) / 100;
            overtime = Math.max(0, Math.round((hours - 8) * 100) / 100);
          }
          status = stay < 300 ? "Half Day" : lateMin > 15 ? "Late" : e.workMode === "Remote" ? "Remote" : "Present";
        }
      }
      attendance.push({ id: `ATT-${at++}`, employeeId: e.id, date: ds, checkIn, checkOut, status, hours, overtime, method, location: method === "Mobile" ? "GPS: Business Bay" : null, notes: "" });
    }
  }
  // Remove the demo employee's record for today so they can try clock-in live
  const demoToday = attendance.findIndex((a) => a.employeeId === demoEmp.id && a.date === iso(TODAY));
  if (demoToday >= 0) attendance.splice(demoToday, 1);
  
  const attendanceCorrections = [
    { id: "AC-1", employeeId: demoEmp.id, date: fx("2026-09-22"), requestedCheckIn: "09:00", requestedCheckOut: "18:05", reason: "Forgot to punch out", status: "Pending", createdAt: ts(addDays(TODAY, -5)) },
    { id: "AC-2", employeeId: employees[20].id, date: fx("2026-09-25"), requestedCheckIn: "08:55", requestedCheckOut: "18:00", reason: "Biometric device failure", status: "Pending", createdAt: ts(addDays(TODAY, -3)) },
  ];
  
  // ---------------------------------------------------------------- Timesheets
  const projects = ["Pharmacy Portal", "E-commerce Website", "Mobile App", "Inventory System", "Internal Tools", "Client Support"];
  const timesheets = [];
  let tsN = 1;
  for (const e of active.filter((x) => x.departmentId === "DEP-3")) {
    for (let back = 14; back >= 1; back--) {
      const d = addDays(TODAY, -back);
      if (isWeekend(d)) continue;
      const hours = pick([8, 8, 8, 9, 7.5, 10]);
      timesheets.push({ id: `TS-${tsN++}`, employeeId: e.id, date: iso(d), project: pick(projects), task: pick(["Development", "Code review", "Bug fixing", "Meetings", "Testing", "Documentation"]), hours, overtime: Math.max(0, hours - 8), billable: rand() > 0.3, status: back > 7 ? "Approved" : pick(["Submitted", "Submitted", "Approved"]), notes: "" });
    }
  }
  
  // ---------------------------------------------------------------- Documents with expiries
  const documents = [];
  let docN = 1;
  for (const e of employees) {
    const uaeNational = e.nationality === "UAE";
    const docs = [
      ["Identity", "Passport", e.passportNumber, int(-200, 1800)],
      ["Identity", "Emirates ID", e.emiratesId, int(-20, 900)],
      ...(uaeNational ? [] : [["Visa", "Residence Visa", `201/${int(2023, 2025)}/${int(1000000, 9999999)}`, int(-15, 900)], ["Visa", "Work Permit", e.laborCardNumber, int(-10, 800)]]),
      ["Employment", "Labour Contract", `MOHRE-${int(100000, 999999)}`, int(30, 1000)],
      ["Employment", "Offer Letter", `OL-${e.id}`, null],
      ["Insurance", "Health Insurance", `DAMAN-${int(100000, 999999)}`, int(-5, 360)],
      ...(e.departmentId === "DEP-8" ? [["Certifications", "DHA License", `DHA-P-${int(10000, 99999)}`, int(10, 700)]] : []),
    ];
    for (const [category, type, number, expiryIn] of docs) {
      documents.push({
        id: `DOC-${docN++}`, employeeId: e.id, category, type, number,
        issueDate: iso(addDays(TODAY, -int(200, 1200))),
        expiryDate: expiryIn === null ? null : iso(addDays(TODAY, expiryIn)),
        status: rand() > 0.1 ? "Verified" : "Pending Verification",
        fileName: `${type.toLowerCase().replace(/\s+/g, "-")}-${e.id}.pdf`,
        version: 1, uploadedBy: hra.id, uploadedAt: ts(addDays(TODAY, -int(10, 500))), notes: "",
      });
    }
  }
  documents.push({ id: `DOC-${docN++}`, employeeId: null, category: "Company", type: "Employee Handbook 2026", number: "POL-001", issueDate: fx("2026-01-01"), expiryDate: null, status: "Verified", fileName: "employee-handbook-2026.pdf", version: 3, uploadedBy: hrm.id, uploadedAt: fx("2026-01-02T06:00:00.000Z"), notes: "Company-wide policy" });
  documents.push({ id: `DOC-${docN++}`, employeeId: null, category: "Company", type: "Leave Policy", number: "POL-002", issueDate: fx("2026-01-01"), expiryDate: null, status: "Verified", fileName: "leave-policy.pdf", version: 2, uploadedBy: hrm.id, uploadedAt: fx("2026-01-02T06:00:00.000Z"), notes: "" });
  
  // ---------------------------------------------------------------- Payroll runs (Jul, Aug, Sep 2026)
  const gross = (s) => s.basic + s.housing + s.transport + s.medical + s.other;
  const payrollRuns = [];
  const months = [3, 2, 1].map((k) => { const d = new Date(TODAY.getFullYear(), TODAY.getMonth() - k, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; });
  months.forEach((m, idx) => {
    const items = active.filter((e) => e.joiningDate <= `${m}-28`).map((e) => {
      const s = e.salary;
      const hourly = s.basic / 30 / 8;
      const otHours = int(0, 12);
      const overtime = Math.round(otHours * hourly * 1.25);
      const bonus = rand() > 0.9 ? int(5, 20) * 100 : 0;
      const commission = e.departmentId === "DEP-5" ? int(5, 40) * 100 : 0;
      const unpaid = rand() > 0.93 ? Math.round((s.basic / 30) * int(1, 3)) : 0;
      const loan = rand() > 0.92 ? 1000 : 0;
      const earnings = gross(s) + overtime + bonus + commission;
      const deductions = unpaid + loan;
      return { employeeId: e.id, basic: s.basic, housing: s.housing, transport: s.transport, medical: s.medical, otherAllowances: s.other, overtimeHours: otHours, overtime, bonus, commission, unpaidLeaveDeduction: unpaid, loanDeduction: loan, otherDeductions: 0, gross: earnings, deductions, net: earnings - deductions };
    });
    const totals = items.reduce((t, i) => ({ gross: t.gross + i.gross, deductions: t.deductions + i.deductions, net: t.net + i.net }), { gross: 0, deductions: 0, net: 0 });
    payrollRuns.push({
      id: `PR-${m}`, month: m, status: idx === 2 ? "Approved" : "Paid", items, totals, employeeCount: items.length,
      createdBy: finm.id, createdAt: ts(new Date(`${m}-25T08:00:00Z`)),
      approvedBy: hrm.id, approvedAt: ts(new Date(`${m}-26T08:00:00Z`)), locked: idx !== 2, paidAt: idx === 2 ? null : ts(new Date(`${m}-28T08:00:00Z`)),
    });
  });
  
  const loans = [
    { id: "LN-1", employeeId: employees[22].id, type: "Loan", amount: 12000, installment: 1000, balance: 7000, startDate: fx("2026-04-01"), status: "Active", reason: "Personal loan" },
    { id: "LN-2", employeeId: employees[35].id, type: "Advance", amount: 3000, installment: 1000, balance: 1000, startDate: fx("2026-08-01"), status: "Active", reason: "Salary advance" },
    { id: "LN-3", employeeId: demoEmp.id, type: "Advance", amount: 2000, installment: 1000, balance: 0, startDate: fx("2026-03-01"), status: "Closed", reason: "Rent deposit" },
  ];
  
  // ---------------------------------------------------------------- Promotions & salary revisions
  const salaryRevisions = [];
  let srN = 1;
  for (const e of active.slice(0, 30)) {
    if (rand() > 0.55) continue;
    const curr = gross(e.salary);
    const pct = pick([5, 8, 10, 12, 15]);
    const promo = rand() > 0.7;
    salaryRevisions.push({
      id: `SR-${srN++}`, employeeId: e.id, type: promo ? "Promotion" : "Salary Revision",
      currentDesignationId: e.designationId, newDesignationId: e.designationId,
      currentSalary: Math.round(curr / (1 + pct / 100)), newSalary: curr, increasePercent: pct,
      effectiveDate: iso(addDays(TODAY, -int(30, 600))), reason: pick(["Annual appraisal", "Outstanding performance", "Market correction", "Role expansion"]),
      status: "Approved", approvals: [{ by: hrm.id, action: "Approved", at: ts(addDays(TODAY, -int(30, 600))) }], createdAt: ts(addDays(TODAY, -int(30, 600))),
    });
  }
  salaryRevisions.push({ id: `SR-${srN++}`, employeeId: demoEmp.id, type: "Salary Revision", currentDesignationId: demoEmp.designationId, newDesignationId: demoEmp.designationId, currentSalary: gross(demoEmp.salary), newSalary: Math.round(gross(demoEmp.salary) * 1.1), increasePercent: 10, effectiveDate: fx("2026-11-01"), reason: "Annual appraisal", status: "Pending", approvals: [], createdAt: ts(addDays(TODAY, -4)) });
  
  // ---------------------------------------------------------------- Recruitment
  const jobs = [
    ["JOB-1", "Senior React Developer", "DEP-3", "DES-7", 2, 20000, 28000, "5+ years", ["React", "TypeScript", "Next.js"], engm.id, "Open"],
    ["JOB-2", "QA Automation Engineer", "DEP-3", "DES-9", 1, 10000, 15000, "3+ years", ["Cypress", "Playwright"], qam.id, "Open"],
    ["JOB-3", "Pharmacist (DHA Licensed)", "DEP-8", "DES-19", 3, 11000, 16000, "2+ years", ["DHA License", "Dispensing"], pham.id, "Open"],
    ["JOB-4", "Sales Executive", "DEP-5", "DES-13", 2, 6000, 11000, "1+ years", ["B2B Sales", "Arabic"], salm.id, "Open"],
    ["JOB-5", "Digital Marketing Specialist", "DEP-6", "DES-15", 1, 8000, 13000, "3+ years", ["SEO", "Paid Ads"], mktm.id, "Pending Approval"],
    ["JOB-6", "Accountant", "DEP-4", "DES-11", 1, 9000, 14000, "3+ years", ["IFRS", "VAT"], finm.id, "On Hold"],
    ["JOB-7", "Warehouse Associate", "DEP-7", "DES-17", 2, 5000, 9000, "1+ years", ["Logistics"], opsm.id, "Closed"],
  ].map(([id, title, departmentId, designationId, vacancies, minSalary, maxSalary, experience, skills, hiringManagerId, status]) => ({
    id, title, departmentId, designationId, vacancies, minSalary, maxSalary, experience, skills, hiringManagerId, status,
    locationId: departmentId === "DEP-7" ? "LOC-3" : "LOC-1", employmentType: "Full-time",
    description: `We are looking for a ${title} to join our ${departments.find((d) => d.id === departmentId).name} team.`,
    postedDate: iso(addDays(TODAY, -int(5, 60))), closingDate: iso(addDays(TODAY, int(10, 45))), createdAt: ts(addDays(TODAY, -int(60, 70))),
  }));
  
  const stages = ["Applied", "Screening", "Shortlisted", "Interview", "Technical Interview", "HR Interview", "Offer", "Hired", "Rejected"];
  const sources = ["LinkedIn", "Bayt", "Naukrigulf", "Referral", "Company Website", "Indeed", "Agency"];
  const candidates = [];
  for (let i = 1; i <= 46; i++) {
    const g = rand() > 0.5 ? "Male" : "Female";
    const first = pick(g === "Male" ? maleFirst : femaleFirst);
    const last = pick(lastNames);
    const job = pick(jobs.filter((j) => j.status !== "Pending Approval"));
    const stage = job.status === "Closed" ? pick(["Hired", "Rejected"]) : pick(stages.slice(0, 8).concat(["Applied", "Screening", "Rejected"]));
    candidates.push({
      id: `CAN-${i}`, name: `${first} ${last}`, email: `${first}.${last.replace(/\s+/g, "")}${i}@mail.com`.toLowerCase(), phone: `+971 5${int(0, 8)} ${int(100, 999)} ${int(1000, 9999)}`,
      jobId: job.id, stage, source: pick(sources), experienceYears: int(1, 12), currentCompany: pick(["Aster", "Life Pharmacy", "Careem", "Noon", "Emaar", "Majid Al Futtaim", "Talabat", "Freelance"]),
      expectedSalary: int(job.minSalary / 500, job.maxSalary / 500) * 500, noticePeriod: pick(["Immediate", "15 days", "30 days", "60 days"]),
      skills: job.skills.slice(0, int(1, job.skills.length)), education: pick(["Bachelor's", "Master's", "Diploma", "PharmD"]),
      rating: int(2, 5), recruiterId: employees[3].id, tags: rand() > 0.7 ? ["Top Talent"] : [],
      resume: `resume-can-${i}.pdf`, notes: "", rejectionReason: stage === "Rejected" ? pick(["Salary expectations", "Skills mismatch", "Withdrew", "Failed technical round"]) : "",
      appliedDate: iso(addDays(TODAY, -int(1, 60))),
    });
  }
  
  const interviews = [];
  let ivN = 1;
  for (const c of candidates.filter((c) => ["Interview", "Technical Interview", "HR Interview", "Offer", "Hired"].includes(c.stage))) {
    const job = jobs.find((j) => j.id === c.jobId);
    const upcoming = ["Interview", "Technical Interview", "HR Interview"].includes(c.stage);
    interviews.push({
      id: `INT-${ivN++}`, candidateId: c.id, jobId: c.jobId, round: c.stage === "HR Interview" ? "HR Interview" : c.stage === "Technical Interview" ? "Technical Interview" : "First Interview",
      date: iso(addDays(TODAY, upcoming ? int(0, 10) : -int(2, 25))), time: pick(["10:00", "11:30", "14:00", "15:30"]), mode: pick(["Onsite", "Video Call", "Phone"]),
      interviewerId: job.hiringManagerId, status: upcoming ? "Scheduled" : "Completed",
      score: upcoming ? null : int(6, 10), recommendation: upcoming ? "" : pick(["Strong Hire", "Hire", "Hire", "Maybe"]), feedback: upcoming ? "" : "Good communication and solid technical fundamentals.",
    });
  }
  const offers = candidates.filter((c) => ["Offer", "Hired"].includes(c.stage)).map((c, i) => ({
    id: `OFF-${i + 1}`, candidateId: c.id, jobId: c.jobId, salary: c.expectedSalary, joiningDate: iso(addDays(TODAY, int(10, 50))),
    status: c.stage === "Hired" ? "Accepted" : pick(["Draft", "Sent", "Sent"]), sentDate: iso(addDays(TODAY, -int(1, 10))), expiryDate: iso(addDays(TODAY, int(3, 14))), notes: "",
  }));
  
  // ---------------------------------------------------------------- Onboarding
  const onboardingTemplate_ = [
    ["Offer letter signed", "Documents", "HR"], ["Employment contract signed", "Documents", "HR"], ["Personal information submitted", "Employee", "Employee"],
    ["Passport & Emirates ID uploaded", "Documents", "Employee"], ["Bank details (IBAN) provided", "Employee", "Employee"], ["Emergency contact added", "Employee", "Employee"],
    ["Visa & work permit processed", "Documents", "HR"], ["Health insurance enrolled", "HR", "HR"], ["Laptop allocated", "IT", "IT"],
    ["Email account created", "IT", "IT"], ["System access granted", "IT", "IT"], ["ID card issued", "Admin", "HR"],
    ["Team introduction", "Manager", "Manager"], ["HR orientation", "HR", "HR"], ["Department orientation", "Manager", "Manager"],
  ];
  const onbStages = ["Offer Accepted", "Documents Collection", "HR Verification", "IT Setup", "Manager Setup", "Employee Joining", "Onboarding Complete"];
  const onboarding = employees.slice(-6).map((e, i) => {
    const doneCount = [15, 13, 10, 7, 4, 2][i];
    return {
      id: `ONB-${i + 1}`, employeeId: e.id, startDate: e.joiningDate, buddyId: e.managerId,
      stage: onbStages[Math.min(6, Math.floor((doneCount / 15) * 6))],
      tasks: onboardingTemplate_.map(([title, category, owner], k) => ({ id: `T${k + 1}`, title, category, owner, done: k < doneCount, dueDate: iso(addDays(new Date(e.joiningDate), k < 8 ? -2 : 5)) })),
      createdAt: ts(addDays(new Date(e.joiningDate), -14)),
    };
  });
  
  // ---------------------------------------------------------------- Performance
  const goals = [
    { id: "GOAL-1", title: "Grow annual revenue to AED 120M", level: "Company", ownerId: ceo.id, departmentId: null, target: "AED 120M", progress: 64, weight: 40, dueDate: fx("2026-12-31"), status: "On Track", keyResults: [{ title: "Open 4 new pharmacies", progress: 50 }, { title: "Online sales +35%", progress: 72 }] },
    { id: "GOAL-2", title: "Reach 250K active customers", level: "Company", ownerId: ceo.id, departmentId: null, target: "250,000", progress: 58, weight: 30, dueDate: fx("2026-12-31"), status: "At Risk", keyResults: [{ title: "Launch loyalty program", progress: 80 }, { title: "Reduce churn below 8%", progress: 40 }] },
    { id: "GOAL-3", title: "Improve website performance", level: "Department", ownerId: cto.id, departmentId: "DEP-3", target: "90 Lighthouse score", progress: 78, weight: 25, dueDate: fx("2026-11-30"), status: "In Progress", keyResults: [{ title: "LCP under 2.0s", progress: 85 }, { title: "Bundle size -30%", progress: 70 }] },
    { id: "GOAL-4", title: "Reduce time-to-hire to 25 days", level: "Department", ownerId: hrm.id, departmentId: "DEP-2", target: "25 days", progress: 45, weight: 30, dueDate: fx("2026-12-15"), status: "In Progress", keyResults: [] },
    { id: "GOAL-5", title: "Close Q4 books within 5 working days", level: "Department", ownerId: finm.id, departmentId: "DEP-4", target: "5 days", progress: 30, weight: 20, dueDate: "2027-01-07", status: "In Progress", keyResults: [] },
    { id: "GOAL-6", title: "Achieve 95% prescription accuracy audit", level: "Department", ownerId: pham.id, departmentId: "DEP-8", target: "95%", progress: 91, weight: 35, dueDate: fx("2026-12-31"), status: "On Track", keyResults: [] },
  ];
  let gN = 7;
  for (const e of active.slice(12, 40)) {
    goals.push({ id: `GOAL-${gN++}`, title: pick(["Complete certification", "Improve customer satisfaction score", "Deliver assigned project milestones", "Reduce error rate", "Mentor a junior colleague", "Increase monthly sales"]), level: "Employee", ownerId: e.id, departmentId: e.departmentId, target: pick(["100%", "4.5/5", "3 milestones", "<2%"]), progress: int(10, 100), weight: pick([10, 20, 25]), dueDate: iso(addDays(TODAY, int(15, 120))), status: pick(["In Progress", "On Track", "At Risk", "Completed"]), keyResults: [] });
  }
  goals.push({ id: `GOAL-${gN++}`, title: "Ship the new checkout flow", level: "Employee", ownerId: demoEmp.id, departmentId: demoEmp.departmentId, target: "Live by Nov 15", progress: 62, weight: 40, dueDate: fx("2026-11-15"), status: "In Progress", keyResults: [{ title: "Payment integration", progress: 90 }, { title: "A/B test", progress: 30 }] });
  
  const reviews = [];
  let rvN = 1;
  for (const e of active.filter((x) => x.managerId)) {
    if (rand() > 0.6) continue;
    const done = rand() > 0.4;
    const self = int(30, 50) / 10;
    const mgr = int(28, 50) / 10;
    reviews.push({ id: `REV-${rvN++}`, employeeId: e.id, reviewerId: e.managerId, cycle: pick([HALF, HALF, `Annual ${Y - 1}`]), type: pick(["Half-year", "Annual", "Quarterly"]), selfScore: done ? self : null, managerScore: done ? mgr : null, finalRating: done ? Math.round(((self + mgr * 2) / 3) * 10) / 10 : null, status: done ? "Completed" : pick(["Self Review", "Manager Review", "Not Started"]), strengths: done ? "Ownership, collaboration" : "", improvements: done ? "Documentation, time estimates" : "", promotionRecommended: done && mgr >= 4.5, dueDate: iso(addDays(TODAY, int(-30, 30))) });
  }
  reviews.push({ id: `REV-${rvN++}`, employeeId: demoEmp.id, reviewerId: engm.id, cycle: NEXT_HALF, type: "Half-year", selfScore: null, managerScore: null, finalRating: null, status: "Self Review", strengths: "", improvements: "", promotionRecommended: false, dueDate: fx("2026-10-20") });
  
  const kpis = [];
  let kN = 1;
  for (const e of active.slice(10, 50)) {
    const kpiNames = { "DEP-5": ["Monthly Sales (AED)", "New Accounts"], "DEP-8": ["Prescriptions Filled", "Accuracy %"], "DEP-3": ["Story Points Delivered", "Bugs Escaped"], "DEP-6": ["Leads Generated", "CTR %"] }[e.departmentId] || ["Tasks Completed", "SLA Adherence %"];
    for (const name of kpiNames) {
      const target = pick([20, 50, 95, 100, 150000]);
      const actual = Math.round(target * (0.6 + rand() * 0.55));
      kpis.push({ id: `KPI-${kN++}`, employeeId: e.id, name, period: QUARTER, weight: 50, target, actual, achievement: Math.round((actual / target) * 100), managerRating: int(3, 5), selfRating: int(3, 5) });
    }
  }
  
  // ---------------------------------------------------------------- Expenses
  const expenseCats = ["Travel", "Accommodation", "Transportation", "Meals", "Office Supplies", "Client Expenses", "Communication", "Training"];
  const expenses = [];
  for (let i = 1; i <= 40; i++) {
    const e = pick(active);
    const status = pick(["Pending", "Pending", "Manager Approved", "Approved", "Reimbursed", "Reimbursed", "Rejected"]);
    expenses.push({ id: `EXP-${i}`, employeeId: e.id, category: pick(expenseCats), amount: int(4, 300) * 10, currency: "AED", date: iso(addDays(TODAY, -int(1, 90))), description: pick(["Client lunch meeting", "Taxi to supplier site", "Conference registration", "Team supplies", "Mobile data top-up", "Hotel stay Abu Dhabi"]), receipt: `receipt-${i}.jpg`, status, approvals: [], createdAt: ts(addDays(TODAY, -int(1, 90))) });
  }
  expenses.push({ id: "EXP-41", employeeId: demoEmp.id, category: "Transportation", amount: 145, currency: "AED", date: fx("2026-09-28"), description: "Taxi to client office", receipt: "receipt-41.jpg", status: "Pending", approvals: [], createdAt: ts(addDays(TODAY, -3)) });
  
  // ---------------------------------------------------------------- Assets
  const assetTypes = [["Laptop", 4500, "MacBook Pro 14\"", "Dell Latitude 7440"], ["Monitor", 900, "Dell 27\" U2723QE", "LG 27UL850"], ["Mobile", 3200, "iPhone 15", "Samsung S24"], ["Headset", 350, "Jabra Evolve2", "Poly Voyager"], ["Access Card", 50, "HID Card", "HID Card"], ["Tablet", 2200, "iPad Air", "Galaxy Tab S9"], ["Keyboard", 250, "Logitech MX Keys", "Apple Magic Keyboard"], ["Company Vehicle", 85000, "Toyota Corolla 2024", "Nissan Sunny 2024"]];
  const assets = [];
  for (let i = 1; i <= 70; i++) {
    const [type, cost, m1, m2] = pick(assetTypes);
    const assigned = rand() > 0.3;
    const e = assigned ? pick(active) : null;
    const status = assigned ? "Assigned" : pick(["In Stock", "In Stock", "Maintenance", "Retired"]);
    const purchase = addDays(TODAY, -int(30, 1300));
    assets.push({ id: `AST-${pad(i, 4)}`, name: pick([m1, m2]), type, serialNumber: `SN${int(10000000, 99999999)}`, purchaseDate: iso(purchase), cost, warrantyExpiry: iso(addDays(purchase, 365 * pick([1, 2, 3]))), status, assignedTo: e ? e.id : null, assignedDate: e ? iso(addDays(purchase, int(1, 30))) : null, condition: pick(["New", "Good", "Good", "Fair"]), locationId: "LOC-1", notes: "", maintenanceHistory: status === "Maintenance" ? [{ date: iso(addDays(TODAY, -3)), note: "Sent for repair" }] : [] });
  }
  
  // ---------------------------------------------------------------- Training
  const trainings = [
    ["UAE Labour Law Essentials", "Compliance", "Fatima Al Hashimi", -40, -39, "Classroom", 25, 4000, "Completed"],
    ["Advanced TypeScript", "Technical", "External - Frontend Masters", 10, 12, "Online", 15, 9000, "Upcoming"],
    ["Leadership Bootcamp", "Leadership", "Dale Carnegie", 25, 27, "Classroom", 12, 30000, "Upcoming"],
    ["Fire Safety & First Aid", "Health & Safety", "Dubai Civil Defence", -10, -10, "Classroom", 40, 6000, "Completed"],
    ["Pharmacovigilance Update", "Clinical", "DHA Academy", 3, 4, "Hybrid", 20, 7500, "Upcoming"],
    ["Customer Service Excellence", "Soft Skills", "Internal", -2, 2, "Classroom", 30, 2000, "In Progress"],
    ["Data Privacy (PDPL)", "Compliance", "Internal", 40, 40, "Online", 100, 0, "Upcoming"],
  ].map(([title, category, trainer, s, e2, mode, seats, budget, status], i) => ({ id: `TRN-${i + 1}`, title, category, trainer, startDate: iso(addDays(TODAY, s)), endDate: iso(addDays(TODAY, e2)), mode, seats, budget, status, enrolled: active.slice(i * 5, i * 5 + int(4, 12)).map((x) => x.id), description: `${title} program.`, certification: rand() > 0.5 }));
  
  // ---------------------------------------------------------------- Helpdesk tickets
  const ticketCats = ["Salary Certificate", "Employment Certificate", "Payslip Issue", "Attendance Correction", "Leave Issue", "Document Request", "Insurance Request", "Visa Request", "Payroll Issue", "General HR Query"];
  const tickets = [];
  for (let i = 1; i <= 28; i++) {
    const e = pick(active);
    const cat = pick(ticketCats);
    const status = pick(["Open", "Open", "In Progress", "Resolved", "Closed"]);
    const created = addDays(TODAY, -int(0, 40));
    tickets.push({ id: `TKT-${1000 + i}`, employeeId: e.id, category: cat, subject: `${cat} request`, description: `Please assist with my ${cat.toLowerCase()}.`, priority: pick(["Low", "Medium", "Medium", "High", "Urgent"]), status, assignedTo: pick([hra.id, hrm.id, employees[3].id]), slaHours: 48, createdAt: ts(created), updatedAt: ts(created), resolution: ["Resolved", "Closed"].includes(status) ? "Issued and shared via email." : "", comments: [] });
  }
  tickets.push({ id: "TKT-1029", employeeId: demoEmp.id, category: "Salary Certificate", subject: "Salary certificate for bank loan", description: "Need a salary certificate addressed to Emirates NBD.", priority: "Medium", status: "In Progress", assignedTo: hra.id, slaHours: 48, createdAt: ts(addDays(TODAY, -1)), updatedAt: ts(addDays(TODAY, -1)), resolution: "", comments: [{ by: hra.id, at: ts(addDays(TODAY, -1)), text: "Working on it, will share by tomorrow." }] });
  
  // ---------------------------------------------------------------- Announcements
  const announcements = [
    { id: "ANN-1", title: "Company Foundation Day – Oct 15", body: "The office will be closed on October 15th to celebrate our foundation day. Join us for the celebration dinner on the 14th!", category: "Event", priority: "Normal", pinned: true, authorId: hrm.id, audience: "All", createdAt: ts(addDays(TODAY, -2)) },
    { id: "ANN-2", title: `Updated Leave Policy ${Y}`, body: "Annual leave carry-forward is now capped at 10 days. Please review the updated policy in the Documents section.", category: "Policy Update", priority: "High", pinned: false, authorId: hrm.id, audience: "All", createdAt: ts(addDays(TODAY, -9)) },
    { id: "ANN-3", title: "Health insurance renewal", body: "Our group health insurance renews on November 1st. Please verify your dependants' details by October 20th.", category: "Office Notice", priority: "High", pinned: false, authorId: hra.id, audience: "All", createdAt: ts(addDays(TODAY, -5)) },
    { id: "ANN-4", title: "Welcome our new joiners!", body: "Please join us in welcoming the colleagues who joined us this month.", category: "Company", priority: "Normal", pinned: false, authorId: hra.id, audience: "All", createdAt: ts(addDays(TODAY, -1)) },
    { id: "ANN-5", title: "Prophet's Birthday holiday", body: "August 25th was a public holiday. Thank you to the pharmacy teams who kept our branches running.", category: "Holiday", priority: "Normal", pinned: false, authorId: hrm.id, audience: "All", createdAt: fx("2026-08-20T06:00:00.000Z") },
  ];
  
  // ---------------------------------------------------------------- Offboarding & settlements
  const exitChecklist = ["Manager approval", "HR review", "Knowledge transfer", "Asset return", "Access removal", "Exit interview", "Final settlement", "Experience certificate", "Clearance certificate"];
  const offboarding = [
    { id: "OFB-1", employeeId: employees[30].id, resignationDate: fx("2026-09-10"), lastWorkingDay: fx("2026-10-10"), reason: "Better opportunity", comments: "Thank you for the experience.", stage: "Notice Period", checklist: exitChecklist.map((t, i) => ({ id: `C${i + 1}`, title: t, done: i < 3 })), exitInterview: null, createdAt: fx("2026-09-10T06:00:00.000Z") },
    { id: "OFB-2", employeeId: employees[47].id, resignationDate: fx("2026-08-01"), lastWorkingDay: fx("2026-08-31"), reason: "Relocation", comments: "", stage: "Completed", checklist: exitChecklist.map((t, i) => ({ id: `C${i + 1}`, title: t, done: true })), exitInterview: { rating: 4, feedback: "Great team, relocating to Canada." }, createdAt: fx("2026-08-01T06:00:00.000Z") },
  ];
  const settlements = [];
  
  // ---------------------------------------------------------------- Employee relations & engagement
  const cases = [
    { id: "CASE-1", employeeId: employees[25].id, type: "Grievance", priority: "Medium", description: "Concern about shift allocation fairness.", assignedTo: hrm.id, status: "Investigating", confidential: true, resolution: "", notes: [], createdAt: ts(addDays(TODAY, -6)) },
    { id: "CASE-2", employeeId: employees[33].id, type: "Warning", priority: "Low", description: "Repeated late arrivals in August.", assignedTo: hra.id, status: "Closed", confidential: false, resolution: "Verbal warning issued.", notes: [], createdAt: ts(addDays(TODAY, -40)) },
    { id: "CASE-3", employeeId: employees[38].id, type: "Policy Violation", priority: "High", description: "Unauthorised sharing of internal documents.", assignedTo: hrm.id, status: "Open", confidential: true, resolution: "", notes: [], createdAt: ts(addDays(TODAY, -2)) },
  ];
  const recognitions = [
    { id: "REC-1", employeeId: employees[14].id, award: "Employee of the Month", reason: "Delivered the pharmacy portal ahead of schedule.", givenBy: cto.id, date: fx("2026-09-30"), points: 500 },
    { id: "REC-2", employeeId: employees[45].id, award: "Team Player", reason: "Covered extra shifts during Eid.", givenBy: pham.id, date: fx("2026-09-15"), points: 200 },
    { id: "REC-3", employeeId: employees[27].id, award: "Best Performer", reason: "Exceeded Q3 sales target by 30%.", givenBy: salm.id, date: fx("2026-09-10"), points: 300 },
    { id: "REC-4", employeeId: ceo.id, award: "Long Service Award", reason: "8 years of leadership.", givenBy: hrm.id, date: fx("2026-02-11"), points: 1000 },
    { id: "REC-5", employeeId: demoEmp.id, award: "Innovation Award", reason: "Proposed the automated stock alert tool.", givenBy: engm.id, date: fx("2026-08-28"), points: 250 },
  ];
  const surveys = [
    { id: "SUR-1", title: "Q3 Pulse Survey", type: "Pulse", status: "Closed", anonymous: true, responses: 48, engagementScore: 78, startDate: fx("2026-09-01"), endDate: fx("2026-09-10") },
    { id: "SUR-2", title: "Annual Engagement Survey 2026", type: "Engagement", status: "Active", anonymous: true, responses: 21, engagementScore: null, startDate: fx("2026-09-25"), endDate: fx("2026-10-15") },
  ];
  
  // ---------------------------------------------------------------- Notifications & audit
  const notifications = [
    { id: "NTF-1", userId: "USR-6", title: "Ticket updated", message: "HR replied on your salary certificate request.", link: "/helpdesk", read: false, createdAt: ts(addDays(TODAY, -1)) },
    { id: "NTF-2", userId: "USR-5", title: "Leave request pending", message: "Ahmed Khan requested 5 days of annual leave.", link: "/leave", read: false, createdAt: ts(addDays(TODAY, -2)) },
    { id: "NTF-3", role: "hr", title: "Documents expiring", message: "Several visas expire within 30 days. Review expiry tracker.", link: "/documents", read: false, createdAt: ts(addDays(TODAY, -1)) },
    { id: "NTF-4", role: "finance", title: `${LM_NAME} payroll approved`, message: `Payroll for ${LM_KEY} approved and ready for WPS export.`, link: "/payroll", read: false, createdAt: ts(addDays(TODAY, -4)) },
  ];
  const auditLogs = [
    { id: "AUD-1", userId: "USR-3", userName: hrm.name, role: "hr_manager", action: "Salary Updated", entity: "employees", entityId: employees[14].id, details: { field: "salary.basic", old: 7000, new: 8000 }, ip: "10.0.4.21", createdAt: ts(addDays(TODAY, -12)) },
    { id: "AUD-2", userId: "USR-4", userName: finm.name, role: "finance", action: "Payroll Approved", entity: "payrollRuns", entityId: `PR-${LM_KEY}`, details: {}, ip: "10.0.4.33", createdAt: ts(addDays(TODAY, -4)) },
    { id: "AUD-3", userId: "USR-2", userName: hra.name, role: "hr_admin", action: "Document Uploaded", entity: "documents", entityId: "DOC-12", details: {}, ip: "10.0.4.18", createdAt: ts(addDays(TODAY, -3)) },
  ];
  
  // ---------------------------------------------------------------- Settings
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
  
  
  const onboardingTemplate = onboardingTemplate_;
  return {
    users, employees, departments, designations, locations, shifts, holidays, leaveTypes, leaves, attendance, attendanceCorrections,
    timesheets, documents, payrollRuns, loans, salaryRevisions, jobs, candidates, interviews, offers, onboarding, goals, reviews, kpis,
    expenses, assets, trainings, tickets, announcements, offboarding, settlements, cases, recognitions, surveys, notifications, auditLogs,
    settings, onboardingTemplate,
  };
}
