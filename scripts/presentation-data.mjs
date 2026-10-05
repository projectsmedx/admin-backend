// Presentation data for MedxDashboard.
//   npm run demo:add      → adds ~5 sample records to every module, linked to your real employees and branches
//   npm run demo:remove   → removes exactly what demo:add created and restores salaries
// Everything created is listed in backups/presentation-data.json (the manifest used for removal).
// Needs the API running (npm run dev). Real employees, departments and branches are never deleted.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = path.join(ROOT, "backups/presentation-data.json");
const API = process.env.API ?? "http://localhost:4000/api/v1";
const ADMIN = { email: process.env.ADMIN_EMAIL ?? "admin@medxpharmacy.com", password: process.env.ADMIN_PASSWORD ?? "Password@123" };
const require = createRequire(path.join(ROOT, "package.json"));

// ----------------------------------------------------------------------------- helpers
let token = "";
async function api(method, p, body) {
  const r = await fetch(API + p, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  const data = text ? JSON.parse(text) : null;
  if (!r.ok) throw new Error(`${method} ${p} → ${r.status} ${data?.message ?? text}`);
  return data;
}
const post = (p, b) => api("POST", p, b ?? {});
const today = new Date(Date.now() + 4 * 3600000);
const iso = (d) => d.toISOString().slice(0, 10);
const day = (n) => { const d = new Date(today); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
/** Next weekday (Mon–Fri) on/after `n` days from today. */
const workday = (n) => { const d = new Date(today); d.setUTCDate(d.getUTCDate() + n); while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1); return iso(d); };

const manifest = { startedAt: new Date().toISOString(), salaryEmployees: [], integrations: [], leaveBalanceKeys: [], tables: {} };
const track = (table, id) => (manifest.tables[table] ??= []).push(id);
const save = () => { fs.mkdirSync(path.dirname(MANIFEST), { recursive: true }); fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2)); };

// ----------------------------------------------------------------------------- add
async function add() {
  if (fs.existsSync(MANIFEST)) throw new Error("Presentation data already exists. Run `npm run demo:remove` first.");
  const login = await fetch(`${API}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ADMIN) });
  if (!login.ok) throw new Error(`Admin login failed (${login.status}). Is the API running?`);
  token = (await login.json()).accessToken;

  const emps = await api("GET", "/employees");
  const E = (name) => { const e = emps.find((x) => x.name === name); if (!e) throw new Error(`Employee ${name} not found`); return e; };
  const depts = await api("GET", "/departments");
  const D = (name) => depts.find((d) => d.name === name)?.id ?? null;
  const branches = await api("GET", "/locations");
  const B = (part) => branches.find((b) => b.name.includes(part))?.id ?? null;
  const lt = await api("GET", "/leave-types");
  const LT = (code) => lt.find((t) => t.code === code)?.id;

  const fleet = ["Fatema Bootwala", "Jafar Ali", "Hredhya Polappadi", "John P Jomy", "Mohammad Millan"].map(E);
  const ecom = ["Moomal Nadeem", "Michelle Joy Philomina", "Sambu Karthikeyan", "Lijin Joy", "Samson C Sunny"].map(E);
  const flowsme = E("Flowsme Vincent"), basheer = E("Basheer Kodiadka"), mathew = E("Mathew Joseph"), riyas = E("Riyas Rahim"), eby = E("Eby John");
  const five = [fleet[0], ecom[0], basheer, riyas, eby];

  try {
    // ---- 1) Sample salaries (restored on removal)
    console.log("• salaries");
    const pkg = (basic) => ({ basic, housing: Math.round(basic * 0.4), transport: Math.round(basic * 0.1), medical: 500, otherAllowances: 0 });
    const basics = { "Mathew Joseph": 30000, "Flowsme Vincent": 11000, "Basheer Kodiadka": 9500, "Riyas Rahim": 9000, "Moomal Nadeem": 8500, "Michelle Joy Philomina": 7000, "Sambu Karthikeyan": 7000, "Lijin Joy": 6500, "Samson C Sunny": 6500 };
    for (const e of emps) {
      await api("PUT", `/employees/${e.id}/salary`, pkg(basics[e.name] ?? 4500));
      manifest.salaryEmployees.push(e.id);
    }
    save();

    // ---- 2) Organization extras
    console.log("• job titles, teams, review cycles, integrations");
    for (const [title, level, dept, min, max] of [["Pharmacist", "L3", "Operation", 9000, 15000], ["Delivery Driver", "L1", "MedX Fleet", 3500, 6000], ["E-Commerce Executive", "L2", "E-Commerce", 6000, 10000], ["Accountant", "L3", "Accounts", 8000, 13000], ["HR Executive", "L3", "HR Department", 8000, 13000]]) {
      track("designations", (await post("/designations", { title, level, departmentId: D(dept), minSalary: min, maxSalary: max, description: `${title} (presentation sample)` })).id);
    }
    for (const [name, dept, lead] of [["Fleet – North Dubai", "MedX Fleet", fleet[0]], ["Fleet – South Dubai", "MedX Fleet", fleet[1]], ["E-Com Operations", "E-Commerce", ecom[0]], ["E-Com Marketing", "E-Commerce", ecom[1]], ["Accounts Payable", "Accounts", basheer]]) {
      track("teams", (await post("/teams", { departmentId: D(dept), name, leadId: lead.id })).id);
    }
    for (const [name, type, s, e2] of [["Q3 2026", "Quarterly", "2026-07-01", "2026-09-30"], ["Q4 2026", "Quarterly", "2026-10-01", "2026-12-31"], ["Probation 2026", "Probation", "2026-01-01", "2026-12-31"], ["Annual 2026", "Annual", "2026-01-01", "2026-12-31"], ["H2 2026", "Half-year", "2026-07-01", "2026-12-31"]]) {
      track("review_cycles", (await post("/review-cycles", { name, type, startDate: s, endDate: e2, status: "open" })).id);
    }
    for (const provider of ["WPS Bank (Emirates NBD)", "Microsoft 365", "Biometric – ZKTeco", "Slack", "Google Workspace"]) {
      await api("PUT", `/integrations/${encodeURIComponent(provider)}`, { enabled: provider.startsWith("WPS"), config: { note: "presentation sample" } });
      manifest.integrations.push(provider);
    }
    save();

    // ---- 3) Attendance, corrections, timesheets
    console.log("• attendance, corrections, timesheets");
    const att = [["08:52", "18:05", "Present", "Biometric"], ["09:24", "18:30", "Late", "Mobile"], ["08:58", "17:40", "Present", "Web"], ["09:02", "19:15", "Present", "GPS"], ["08:45", "18:00", "Remote", "Web"]];
    for (const [k, e] of five.entries()) {
      const [i, o, status, method] = att[k];
      const hours = Math.round(((Number(o.slice(0, 2)) * 60 + Number(o.slice(3)) - Number(i.slice(0, 2)) * 60 - Number(i.slice(3)) - 60) / 60) * 100) / 100;
      track("attendance_records", (await post("/attendance", { employeeId: e.id, date: day(-1), checkIn: i, checkOut: o, status, hours, overtime: Math.max(0, Math.round((hours - 8) * 100) / 100), method })).id);
    }
    for (const [k, e] of fleet.entries()) {
      const c = await post("/attendance-corrections", { employeeId: e.id, date: day(-3 - k), requestedCheckIn: "09:00", requestedCheckOut: "18:00", reason: ["Forgot to punch out", "Biometric device offline", "On delivery route", "Mobile app issue", "Badge not working"][k] });
      track("attendance_corrections", c.id);
      if (k < 2) await post(`/attendance-corrections/${c.id}/approve`);
      if (k === 2) await post(`/attendance-corrections/${c.id}/reject`, { comment: "Please attach the delivery log" });
    }
    for (const [k, e] of ecom.entries()) {
      const t = await post("/timesheets", { employeeId: e.id, date: day(-1 - k), project: ["Website Revamp", "Marketplace Listings", "Customer Support", "Mobile App", "Online Promotions"][k], task: ["Development", "Content", "Support", "Testing", "Campaign"][k], hours: [8, 9, 7.5, 8, 10][k], billable: k !== 2 });
      track("timesheet_entries", t.id);
      if (k < 2) await post(`/timesheets/${t.id}/approve`);
    }
    save();

    // ---- 4) Leave
    console.log("• leave");
    const leaveDefs = [[fleet[0], "SL", 7, 7, "Fever", "approve"], [ecom[0], "WFH", 8, 8, "Working from home", "approve"], [basheer, "EL", 9, 9, "Family emergency", null], [riyas, "SL", 14, 15, "Medical appointment", "reject"], [ecom[2], "WFH", 11, 11, "Internet installation at home", null]];
    for (const [e, code, a, b2, reason, act] of leaveDefs) {
      const l = await post("/leaves", { employeeId: e.id, leaveTypeId: LT(code), from: workday(a), to: workday(b2), reason });
      track("leave_requests", l.id);
      if (act === "approve") await post(`/leaves/${l.id}/approve`, { comment: "Approved" });
      if (act === "reject") await post(`/leaves/${l.id}/reject`, { comment: "Busy period — please choose another date" });
    }
    for (const e of five) {
      await post("/leave-balances/adjust", { employeeId: e.id, leaveTypeId: LT("AL"), adjustment: 5, carriedForward: 0, note: "Presentation sample" });
      manifest.leaveBalanceKeys.push([e.id, LT("AL"), today.getUTCFullYear()]);
    }
    save();

    // ---- 5) Documents
    console.log("• documents");
    const docDefs = [[fleet[1], "Identity", "Passport", "P4458712", -900, -12], [fleet[2], "Identity", "Emirates ID", "784-1990-4521877-1", -700, 20], [ecom[1], "Visa", "Residence Visa", "201/2025/7781234", -300, 60], [basheer, "Employment", "Labour Contract", "MOHRE-778812", -200, 520], [mathew, "Insurance", "Health Insurance", "DAMAN-552190", -100, 265]];
    for (const [k, [e, category, type, number, issued, expires]] of docDefs.entries()) {
      const d = await post("/documents", { employeeId: e.id, category, type, number, issueDate: day(issued), expiryDate: day(expires), fileName: `${type.toLowerCase().replace(/\s+/g, "-")}-${e.code}.pdf` });
      track("documents", d.id);
      if (k === 0) await post(`/documents/${d.id}/versions`, { fileName: `passport-${e.code}-renewal.pdf`, note: "Renewal copy uploaded" });
    }
    save();

    // ---- 6) Payroll, loans, revisions, settlements
    console.log("• loans, payroll, salary revisions, final settlements");
    for (const [k, e] of [fleet[3], fleet[4], ecom[3], riyas, eby].entries()) {
      track("employee_loans", (await post("/loans", { employeeId: e.id, type: k % 2 ? "Advance" : "Loan", amount: [6000, 2000, 4500, 3000, 1500][k], installment: [1000, 1000, 750, 1000, 500][k], startDate: day(-20), reason: ["Family expenses", "Salary advance", "Car repair", "School fees", "Rent deposit"][k] })).id);
    }
    const run = await post("/payroll-runs", { period: today.toISOString().slice(0, 7) });
    track("payroll_runs", run.id);
    for (const [k, e] of [mathew, flowsme, ecom[0]].entries()) await api("PATCH", `/payroll-runs/${run.id}/items/${e.id}`, { bonus: [5000, 1500, 1000][k], notes: "Performance bonus" });
    await post(`/payroll-runs/${run.id}/approve`);
    for (const [k, e] of [ecom[0], fleet[0], basheer, flowsme, riyas].entries()) {
      const cur = Object.values(e.salary ?? {}).reduce((a, b2) => a + Number(b2), 0);
      const r = await post("/salary-revisions", { employeeId: e.id, type: "Salary Revision", newSalary: Math.round((cur || 8000) * [1.1, 1.08, 1.12, 1.05, 1.1][k]), effectiveDate: day(30), reason: ["Annual appraisal", "Outstanding performance", "Market correction", "Role expansion", "Annual appraisal"][k] });
      track("salary_revisions", r.id);
      if (k === 1) await post(`/salary-revisions/${r.id}/approve`, { comment: "Approved for presentation" });
      if (k === 3) await post(`/salary-revisions/${r.id}/reject`, { comment: "Budget review in January" });
    }
    for (const [k, e] of [fleet[4], ecom[4], eby, ecom[3], fleet[3]].entries()) {
      const p = await post("/settlements/preview", { employeeId: e.id, lastWorkingDay: day(60 + k * 7), separationType: ["Resignation", "Contract end", "Resignation", "Termination", "Mutual agreement"][k], bonus: [0, 500, 0, 0, 1000][k], noticeShortfallDays: [0, 0, 5, 0, 0][k] });
      const s = await post("/settlements", { ...p, reason: p.reason });
      track("final_settlements", s.id);
      if (k === 0) await post(`/settlements/${s.id}/approve`);
    }
    save();

    // ---- 7) Recruitment
    console.log("• recruitment");
    const jobs = [];
    for (const [title, dept, n, min, max, mgr, loc] of [["Pharmacist (DHA Licensed)", "Operation", 3, 11000, 16000, riyas, "Al Barsha"], ["Delivery Driver", "MedX Fleet", 4, 3500, 6000, fleet[0], null], ["E-Commerce Executive", "E-Commerce", 2, 6000, 10000, ecom[0], null], ["Accountant", "Accounts", 1, 8000, 13000, basheer, null], ["HR Executive", "HR Department", 1, 8000, 12000, flowsme, null]]) {
      const j = await post("/jobs", { title, departmentId: D(dept), vacancies: n, minSalary: min, maxSalary: max, experience: "2+ years", skills: [], hiringManagerId: mgr.id, locationId: loc ? B(loc) : null, closingDate: day(30), description: `${title} for MedX (presentation sample)` });
      track("job_requisitions", j.id);
      jobs.push(j);
    }
    const cands = [];
    for (const [k, [name, stage]] of [["Aisha Rahman", "Screening"], ["Omar Siddiqui", "Interview"], ["Priya Menon", "HR Interview"], ["Daniel Fernandes", "Offer"], ["Sara Haddad", "Rejected"]].entries()) {
      const c = await post("/candidates", { name, email: `${name.toLowerCase().replace(/\s+/g, ".")}@example.com`, phone: `+971 50 ${100 + k}0 ${2000 + k * 37}`, jobId: jobs[k].id, source: ["LinkedIn", "Bayt", "Referral", "Company Website", "Indeed"][k], experienceYears: [3, 5, 4, 6, 2][k], expectedSalary: [12000, 5000, 8000, 11000, 9000][k], skills: [], rating: [4, 3, 5, 4, 2][k], notes: "Presentation sample" });
      track("candidates", c.id);
      cands.push(c);
      await post(`/candidates/${c.id}/move`, { stage, reason: stage === "Rejected" ? "Salary expectations" : undefined });
    }
    for (const [k, c] of cands.entries()) {
      track("interviews", (await post("/interviews", { candidateId: c.id, round: ["First Interview", "Technical Interview", "HR Interview", "Final Interview", "First Interview"][k], date: k < 3 ? workday(2 + k) : day(-5), time: ["10:00", "11:30", "14:00", "15:30", "10:30"][k], mode: ["Video Call", "Onsite", "Onsite", "Video Call", "Phone"][k], interviewerId: [riyas, fleet[0], ecom[0], basheer, flowsme][k].id })).id);
    }
    for (const [k, c] of cands.entries()) {
      const o = await post("/offers", { candidateId: c.id, salary: c.expectedSalary, joiningDate: day(30 + k * 5), expiryDate: day(10), notes: "Presentation sample" });
      track("offers", o.id);
      if (k >= 2) await post(`/offers/${o.id}/send`);
      if (k === 3) await post(`/offers/${o.id}/accept`);
    }
    save();

    // ---- 8) Onboarding
    console.log("• onboarding");
    for (const [k, e] of [ecom[4], ecom[3], fleet[4], fleet[3], eby].entries()) {
      const o = await post("/onboarding", { employeeId: e.id, startDate: e.joiningDate });
      track("onboarding_processes", o.id);
      for (const t of o.tasks.slice(0, [13, 10, 7, 4, 2][k])) await api("PATCH", `/onboarding/${o.id}/tasks/${t.id}`, { isDone: true });
    }
    save();

    // ---- 9) Performance
    console.log("• goals, reviews, KPIs");
    for (const [title, level, owner, dept, target, progress, status] of [["Grow online orders by 30%", "Department", ecom[0], "E-Commerce", "+30% orders", 45, "On Track"], ["On-time delivery above 97%", "Department", fleet[0], "MedX Fleet", "97% on time", 82, "In Progress"], ["Close monthly books in 5 days", "Department", basheer, "Accounts", "5 working days", 60, "In Progress"], ["Open Ras Al Khaimah branch", "Company", mathew, "Director", "Opening by December", 70, "On Track"], ["Reduce staff turnover", "Department", flowsme, "HR Department", "Below 10%", 30, "At Risk"]]) {
      track("goals", (await post("/goals", { title, level, ownerId: owner.id, departmentId: D(dept), target, progress, weight: 25, dueDate: day(80), status, keyResults: [{ title: "Milestone 1", progress: Math.min(100, progress + 20) }, { title: "Milestone 2", progress: Math.max(0, progress - 20) }] })).id);
    }
    for (const [k, e] of [fleet[0], ecom[0], basheer, riyas, ecom[1]].entries()) {
      const r = await post("/reviews", { employeeId: e.id, cycle: "Q3 2026", type: "Quarterly", reviewerId: mathew.id, dueDate: day(15) });
      track("performance_reviews", r.id);
      if (k < 3) await api("PATCH", `/reviews/${r.id}`, { selfScore: [4, 4.5, 3.5][k], strengths: "Reliable and customer-focused", improvements: "Documentation" });
      if (k < 2) await api("PATCH", `/reviews/${r.id}`, { managerScore: [4.2, 4.8][k] });
    }
    for (const [k, [e, name, target, actual]] of [[fleet[0], "Deliveries completed", 600, 642], [ecom[0], "Online orders processed", 1500, 1380], [basheer, "Invoices processed", 400, 412], [riyas, "Store audits passed", 23, 21], [ecom[2], "Product listings updated", 300, 255]].entries()) {
      track("kpis", (await post("/kpis", { employeeId: e.id, name, period: "Q3 2026", weight: 50, target, actual, selfRating: [4, 4, 5, 4, 3][k], managerRating: [4, 3, 5, 4, 3][k] })).id);
    }
    save();

    // ---- 10) Expenses
    console.log("• expenses");
    for (const [k, [e, category, amount, desc]] of [[fleet[1], "Transportation", 145, "Fuel top-up for delivery van"], [ecom[1], "Meals", 210, "Team lunch during Eid campaign"], [basheer, "Office Supplies", 380, "Printer toner and paper"], [riyas, "Travel", 650, "Branch visit — Ras Al Khaimah"], [flowsme, "Training", 1200, "HR certification course"]].entries()) {
      const x = await post("/expenses", { employeeId: e.id, category, amount, date: day(-3 - k), description: desc, receipt: `receipt-${k + 1}.jpg` });
      track("expense_claims", x.id);
      if (k <= 2) await post(`/expenses/${x.id}/approve`, { comment: "OK" });
      if (k === 0) await post(`/expenses/${x.id}/reimburse`);
      if (k === 3) await post(`/expenses/${x.id}/reject`, { comment: "Please submit with mileage log" });
    }
    save();

    // ---- 11) Assets
    console.log("• assets");
    for (const [k, [name, type, cost, holder]] of [["Dell Latitude 7440", "Laptop", 4800, ecom[0]], ["iPhone 15", "Mobile", 3400, fleet[0]], ["Toyota Hiace (Delivery Van)", "Company Vehicle", 98000, fleet[1]], ["Zebra Barcode Scanner", "Other", 1200, null], ["HID Access Card", "Access Card", 50, basheer]].entries()) {
      const a = await post("/assets", { name, type: type === "Other" ? "Tablet" : type, serialNumber: `MX-PRES-${1000 + k}`, purchaseDate: day(-120 - k * 30), cost, warrantyExpiry: day(240 - k * 60), status: "In Stock", condition: "New", notes: "Presentation sample" });
      track("assets", a.id);
      if (holder) await post(`/assets/${a.id}/assign`, { employeeId: holder.id });
      if (k === 3) await post(`/assets/${a.id}/maintenance`, { description: "Battery replacement", cost: 150, vendor: "Zebra UAE" });
    }
    save();

    // ---- 12) Training
    console.log("• training");
    for (const [k, [title, category, mode, budget, attendees]] of [["DHA Pharmacy Compliance", "Compliance", "Classroom", 6000, [riyas, mathew]], ["Defensive Driving", "Health & Safety", "Classroom", 4500, fleet.slice(0, 4)], ["E-Commerce Analytics", "Technical", "Online", 3500, ecom.slice(0, 3)], ["UAE Labour Law Essentials", "Compliance", "Hybrid", 2500, [flowsme, basheer]], ["Customer Service Excellence", "Soft Skills", "Classroom", 3000, [ecom[3], ecom[4], eby]]].entries()) {
      const t = await post("/trainings", { title, category, trainer: ["DHA Academy", "RTA Training Centre", "Internal", "MOHRE", "Internal"][k], startDate: day([-10, 7, 14, 21, -2][k]), endDate: day([-9, 8, 16, 21, 2][k]), mode, seats: 20, budget, status: ["Completed", "Upcoming", "Upcoming", "Upcoming", "In Progress"][k], certification: k < 2, description: `${title} (presentation sample)` });
      track("training_programs", t.id);
      await post(`/trainings/${t.id}/enrollments`, { employeeIds: attendees.map((x) => x.id) });
    }
    save();

    // ---- 13) Helpdesk, cases, recognition, surveys, announcements
    console.log("• helpdesk, cases, recognition, surveys, announcements");
    for (const [k, [e, category, subject, priority]] of [[ecom[0], "Salary Certificate", "Salary certificate for bank loan", "Medium"], [fleet[2], "Visa Request", "Visa renewal documents", "High"], [basheer, "Payroll Issue", "Overtime missing in payslip", "High"], [ecom[2], "Insurance Request", "Add spouse to health insurance", "Medium"], [fleet[3], "Employment Certificate", "Employment letter for embassy", "Low"]].entries()) {
      const t = await post("/tickets", { employeeId: e.id, category, subject, description: `${subject} (presentation sample)`, priority });
      track("tickets", t.id);
      if (k < 3) await post(`/tickets/${t.id}/comments`, { text: "Thanks, we're on it — expect an update within 24 hours." });
      if (k === 0) await post(`/tickets/${t.id}/resolve`, { resolution: "Certificate issued and emailed." });
    }
    for (const [k, [e, type, priority, desc, confidential]] of [[fleet[4], "Grievance", "Medium", "Concern about delivery route allocation", true], [ecom[3], "Warning", "Low", "Repeated late arrivals", false], [eby, "Investigation", "High", "Vehicle damage report under review", true], [ecom[4], "Employee Complaint", "Medium", "Workstation equipment complaint", false], [fleet[1], "Policy Violation", "High", "Uniform policy not followed", false]].entries()) {
      const c = await post("/cases", { employeeId: e.id, type, priority, description: `${desc} (presentation sample)`, assignedTo: flowsme.id, confidential });
      track("er_cases", c.id);
      if (k < 2) await post(`/cases/${c.id}/notes`, { body: "Initial meeting held with the employee." });
    }
    for (const [e, award, reason, points] of [[fleet[0], "Employee of the Month", "Highest on-time delivery rate in September.", 500], [ecom[0], "Best Performer", "Record online sales during the campaign.", 300], [basheer, "Team Player", "Helped close the books early.", 200], [riyas, "Innovation Award", "New stock-check routine across branches.", 250], [mathew, "Long Service Award", "Years of leadership at MedX.", 1000]]) {
      track("recognitions", (await post("/recognitions", { employeeId: e.id, award, reason, points })).id);
    }
    const questions = [{ id: "q1", text: "How satisfied are you working at MedX?", type: "scale" }, { id: "q2", text: "Would you recommend MedX as a workplace?", type: "scale" }, { id: "q3", text: "What should we improve?", type: "text" }];
    const surveys = [];
    for (const [k, title] of ["October Pulse Survey", "Annual Engagement Survey 2026", "Fleet Safety Feedback", "E-Commerce Tools Survey", "Training Needs Survey"].entries()) {
      const s = await post("/surveys", { title, type: k === 0 ? "Pulse" : "Engagement", anonymous: true, status: k < 3 ? "Active" : "Closed", startDate: day(-7), endDate: day(14), questions, engagementScore: k >= 3 ? [76, 81][k - 3] : null });
      track("surveys", s.id);
      surveys.push(s);
    }
    for (const [k, ans] of [[5, 5, "More training"], [4, 4, "Better tools"], [4, 5, "Flexible hours"], [3, 4, "Clearer communication"], [5, 4, "Nothing — great team"]].entries()) {
      await post(`/surveys/${surveys[0].id}/responses`, { answers: { q1: ans, q2: [5, 4, 5, 4, 4][k], q3: ["More training", "Better tools", "Flexible hours", "Clearer communication", "Nothing — great team"][k] } });
    }
    for (const [title, category, priority, pinned, body] of [["Welcome to MedxDashboard", "Company", "Normal", true, "Our new HR platform is live. Check your profile and leave balance."], ["Ras Al Khaimah branch opening soon", "Company", "High", false, "Our 23rd branch opens in Ras Al Khaimah. Stay tuned for the opening date."], ["Updated delivery safety policy", "Policy Update", "High", false, "All drivers must complete the defensive driving course by month end."], ["Company Foundation Day", "Event", "Normal", false, "Join us for the celebration dinner on October 14th."], ["UAE National Day holidays", "Holiday", "Normal", false, "Offices will be closed on 2–3 December. Branches follow their rota."]]) {
      track("announcements", (await post("/announcements", { title, body, category, priority, pinned, audience: "All" })).id);
    }
    save();

    // ---- 14) Offboarding (submitted only — employee status is not changed)
    console.log("• offboarding");
    for (const [k, e] of [fleet[3], ecom[4], eby, fleet[4], ecom[3]].entries()) {
      track("exits", (await post("/exits", { employeeId: e.id, resignationDate: day(-k), lastWorkingDay: day(30 + k * 7), reason: ["Better opportunity", "Relocation", "Higher studies", "Personal reasons", "Contract end"][k], comments: "Presentation sample" })).id);
    }
    save();
    console.log(`\nDone. Presentation data added. Manifest: ${path.relative(ROOT, MANIFEST)}\nRemove it any time with: npm run demo:remove`);
  } catch (e) {
    save();
    console.error(`\nStopped: ${e.message}\nWhat was created so far is in the manifest — run \`npm run demo:remove\` to clean it up.`);
    process.exitCode = 1;
  }
}

// ----------------------------------------------------------------------------- remove
async function remove() {
  if (!fs.existsSync(MANIFEST)) throw new Error("No presentation data manifest found — nothing to remove.");
  const m = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/).map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l)).filter(Boolean).map((x) => [x[1], x[2]]));
  const pg = require("pg");
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? env.DATABASE_URL });
  await db.connect();
  const T = (t) => m.tables[t] ?? [];
  const q = (sql, params = []) => db.query(sql, params);
  try {
    await q("BEGIN");
    const wf = [...T("leave_requests"), ...T("expense_claims"), ...T("salary_revisions")];
    if (wf.length) await q("DELETE FROM approval_steps WHERE entity_id = ANY($1)", [wf]);
    await q("DELETE FROM document_reminders WHERE document_id = ANY($1)", [T("documents")]);
    await q("DELETE FROM document_versions WHERE document_id = ANY($1)", [T("documents")]);
    await q("DELETE FROM documents WHERE id = ANY($1)", [T("documents")]);
    await q("DELETE FROM loan_repayments WHERE loan_id = ANY($1) OR payroll_item_id IN (SELECT id FROM payroll_items WHERE payroll_run_id = ANY($2))", [T("employee_loans"), T("payroll_runs")]);
    await q("DELETE FROM payroll_items WHERE payroll_run_id = ANY($1)", [T("payroll_runs")]);
    await q("DELETE FROM payroll_runs WHERE id = ANY($1)", [T("payroll_runs")]);
    await q("DELETE FROM employee_loans WHERE id = ANY($1)", [T("employee_loans")]);
    await q("DELETE FROM final_settlement_lines WHERE settlement_id = ANY($1)", [T("final_settlements")]);
    await q("DELETE FROM final_settlements WHERE id = ANY($1)", [T("final_settlements")]);
    await q("DELETE FROM exit_checklist_items WHERE exit_id = ANY($1)", [T("exits")]);
    await q("DELETE FROM exits WHERE id = ANY($1)", [T("exits")]);
    await q("DELETE FROM onboarding_tasks WHERE process_id = ANY($1)", [T("onboarding_processes")]);
    await q("DELETE FROM onboarding_processes WHERE id = ANY($1)", [T("onboarding_processes")]);
    await q("DELETE FROM key_results WHERE goal_id = ANY($1)", [T("goals")]);
    await q("DELETE FROM goals WHERE id = ANY($1)", [T("goals")]);
    await q("DELETE FROM performance_reviews WHERE id = ANY($1)", [T("performance_reviews")]);
    await q("DELETE FROM review_cycles WHERE id = ANY($1) OR (created_at >= $2 AND NOT EXISTS (SELECT 1 FROM performance_reviews r WHERE r.cycle_id = review_cycles.id))", [T("review_cycles"), m.startedAt]);
    await q("DELETE FROM kpis WHERE id = ANY($1)", [T("kpis")]);
    await q("DELETE FROM salary_revisions WHERE id = ANY($1)", [T("salary_revisions")]);
    await q("DELETE FROM expense_claims WHERE id = ANY($1)", [T("expense_claims")]);
    await q("DELETE FROM asset_maintenance WHERE asset_id = ANY($1)", [T("assets")]);
    await q("DELETE FROM asset_assignments WHERE asset_id = ANY($1)", [T("assets")]);
    await q("DELETE FROM assets WHERE id = ANY($1)", [T("assets")]);
    await q("DELETE FROM training_enrollments WHERE program_id = ANY($1)", [T("training_programs")]);
    await q("DELETE FROM training_programs WHERE id = ANY($1)", [T("training_programs")]);
    await q("DELETE FROM ticket_comments WHERE ticket_id = ANY($1)", [T("tickets")]);
    await q("DELETE FROM tickets WHERE id = ANY($1)", [T("tickets")]);
    await q("DELETE FROM er_case_notes WHERE case_id = ANY($1)", [T("er_cases")]);
    await q("DELETE FROM er_cases WHERE id = ANY($1)", [T("er_cases")]);
    await q("DELETE FROM recognitions WHERE id = ANY($1)", [T("recognitions")]);
    await q("DELETE FROM survey_responses WHERE survey_id = ANY($1)", [T("surveys")]);
    await q("DELETE FROM surveys WHERE id = ANY($1)", [T("surveys")]);
    await q("DELETE FROM announcements WHERE id = ANY($1)", [T("announcements")]);
    await q("DELETE FROM interviews WHERE id = ANY($1) OR candidate_id = ANY($2)", [T("interviews"), T("candidates")]);
    await q("DELETE FROM offers WHERE id = ANY($1) OR candidate_id = ANY($2)", [T("offers"), T("candidates")]);
    await q("DELETE FROM candidate_stage_history WHERE candidate_id = ANY($1)", [T("candidates")]);
    await q("DELETE FROM candidates WHERE id = ANY($1)", [T("candidates")]);
    await q("DELETE FROM job_requisitions WHERE id = ANY($1)", [T("job_requisitions")]);
    // Attendance rows created by approved corrections are dated on the correction day
    await q("DELETE FROM attendance_records WHERE id = ANY($1) OR (created_at >= $2 AND (employee_id, work_date) IN (SELECT employee_id, work_date FROM attendance_corrections WHERE id = ANY($3)))", [T("attendance_records"), m.startedAt, T("attendance_corrections")]);
    await q("DELETE FROM attendance_corrections WHERE id = ANY($1)", [T("attendance_corrections")]);
    await q("DELETE FROM timesheet_entries WHERE id = ANY($1)", [T("timesheet_entries")]);
    await q("DELETE FROM projects WHERE created_at >= $1 AND NOT EXISTS (SELECT 1 FROM timesheet_entries t WHERE t.project_id = projects.id)", [m.startedAt]);
    await q("DELETE FROM leave_requests WHERE id = ANY($1)", [T("leave_requests")]);
    for (const [emp, type, year] of m.leaveBalanceKeys) await q("DELETE FROM leave_balances WHERE employee_id=$1 AND leave_type_id=$2 AND year=$3", [emp, type, year]);
    await q("DELETE FROM teams WHERE id = ANY($1)", [T("teams")]);
    await q("DELETE FROM designations WHERE id = ANY($1)", [T("designations")]);
    await q("DELETE FROM integrations WHERE provider = ANY($1)", [m.integrations]);
    // Salaries: drop every structure created during the presentation and reopen the previous one
    await q("DELETE FROM salary_structures WHERE employee_id = ANY($1) AND created_at >= $2", [m.salaryEmployees, m.startedAt]);
    await q(`UPDATE salary_structures s SET effective_to = NULL WHERE s.id IN (
               SELECT DISTINCT ON (employee_id) id FROM salary_structures WHERE employee_id = ANY($1) ORDER BY employee_id, effective_from DESC, created_at DESC)`, [m.salaryEmployees]);
    // Notifications / emails generated by the sample activity
    await q("DELETE FROM notification_reads WHERE notification_id IN (SELECT id FROM notifications WHERE created_at >= $1)", [m.startedAt]);
    await q("DELETE FROM notifications WHERE created_at >= $1", [m.startedAt]);
    await q("DELETE FROM email_outbox WHERE created_at >= $1", [m.startedAt]);
    await q(`DELETE FROM files f WHERE f.created_at >= $1
               AND NOT EXISTS (SELECT 1 FROM documents WHERE file_id=f.id) AND NOT EXISTS (SELECT 1 FROM document_versions WHERE file_id=f.id)
               AND NOT EXISTS (SELECT 1 FROM leave_requests WHERE attachment_file_id=f.id) AND NOT EXISTS (SELECT 1 FROM expense_claims WHERE receipt_file_id=f.id)
               AND NOT EXISTS (SELECT 1 FROM candidates WHERE resume_file_id=f.id) AND NOT EXISTS (SELECT 1 FROM offers WHERE letter_file_id=f.id)
               AND NOT EXISTS (SELECT 1 FROM employees WHERE avatar_file_id=f.id) AND NOT EXISTS (SELECT 1 FROM payroll_runs WHERE wps_file_id=f.id)
               AND NOT EXISTS (SELECT 1 FROM training_enrollments WHERE certificate_file_id=f.id) AND NOT EXISTS (SELECT 1 FROM ticket_comments WHERE attachment_file_id=f.id)
               AND NOT EXISTS (SELECT 1 FROM er_case_notes WHERE attachment_file_id=f.id) AND NOT EXISTS (SELECT 1 FROM company WHERE logo_file_id=f.id)`, [m.startedAt]);
    await q("INSERT INTO audit_logs (user_name, action, entity, changes) VALUES ('System', 'Presentation Data Removed', 'system', $1)", [JSON.stringify({ addedAt: m.startedAt })]);
    await q("COMMIT");
    fs.renameSync(MANIFEST, MANIFEST.replace(".json", `-removed-${Date.now()}.json`));
    console.log("Presentation data removed and salaries restored.");
  } catch (e) {
    await q("ROLLBACK");
    throw e;
  } finally {
    await db.end();
  }
}

const cmd = process.argv[2];
if (cmd === "add") await add();
else if (cmd === "remove") await remove();
else console.log("Usage: node scripts/presentation-data.mjs <add|remove>");
