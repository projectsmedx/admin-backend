// PostgreSQL enum types and their display labels used by the API/UI.
// DB stores snake_case values ('manager_approved'); the API speaks labels ('Manager Approved').

export const ENUMS = {
  user_role: ["super_admin", "manager", "pharmacist", "developer", "marketing", "customer_support"],
  access_scope: ["own", "team", "department", "all"],
  gender: ["male", "female"],
  employment_type: ["full_time", "part_time", "contract", "intern"],
  work_mode: ["office", "hybrid", "remote"],
  employee_status: ["active", "probation", "on_leave", "notice_period", "resigned", "terminated"],
  job_status: ["draft", "pending_approval", "open", "on_hold", "closed"],
  candidate_stage: ["applied", "screening", "shortlisted", "interview", "technical_interview", "hr_interview", "offer", "hired", "rejected"],
  interview_status: ["scheduled", "completed", "cancelled", "no_show"],
  offer_status: ["draft", "sent", "accepted", "declined"],
  onboarding_stage: ["offer_accepted", "documents_collection", "hr_verification", "it_setup", "manager_setup", "employee_joining", "onboarding_complete"],
  shift_type: ["morning", "evening", "night", "flexible", "rotational", "remote"],
  attendance_status: ["present", "late", "absent", "half_day", "remote", "on_leave", "holiday"],
  request_status: ["pending", "approved", "rejected"],
  timesheet_status: ["draft", "submitted", "approved", "rejected"],
  leave_status: ["pending", "manager_approved", "approved", "rejected", "cancelled"],
  holiday_type: ["public", "company", "department", "custom"],
  payroll_status: ["draft", "approved", "locked", "paid"],
  loan_type: ["loan", "advance"],
  settlement_status: ["draft", "approved", "paid"],
  goal_level: ["company", "department", "employee"],
  goal_status: ["not_started", "in_progress", "on_track", "at_risk", "completed"],
  review_status: ["not_started", "self_review", "manager_review", "completed"],
  expense_status: ["pending", "manager_approved", "approved", "reimbursed", "rejected"],
  document_category: ["identity", "employment", "visa", "education", "certifications", "payroll", "performance", "medical", "insurance", "company"],
  document_status: ["verified", "pending_verification", "rejected"],
  asset_status: ["in_stock", "assigned", "maintenance", "returned", "retired"],
  priority: ["low", "medium", "high", "urgent"],
  ticket_status: ["open", "in_progress", "resolved", "closed"],
  exit_stage: ["submitted", "hr_review", "notice_period", "completed", "withdrawn"],
} as const;
export type EnumName = keyof typeof ENUMS;

// Enums whose raw value is the API value (used as keys in code)
const RAW: EnumName[] = ["user_role", "access_scope"];
const WORDS: Record<string, string> = { hr: "HR", it: "IT" };
const SPECIAL: Record<string, string> = { full_time: "Full-time", part_time: "Part-time" };

export function label(value: string): string {
  if (SPECIAL[value]) return SPECIAL[value];
  return value.split("_").map((w) => WORDS[w] ?? w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

const reverse = new Map<string, Map<string, string>>();
for (const [name, values] of Object.entries(ENUMS)) {
  const m = new Map<string, string>();
  for (const v of values) {
    m.set(label(v).toLowerCase(), v);
    m.set(v, v);
  }
  reverse.set(name, m);
}

export function toApiEnum(name: EnumName, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return RAW.includes(name) ? String(value) : label(String(value));
}

/** Accepts a label ("Manager Approved") or raw value ("manager_approved"); throws on unknown values. */
export function toDbEnum(name: EnumName, value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const v = reverse.get(name)!.get(String(value).toLowerCase().trim()) ?? reverse.get(name)!.get(String(value).trim());
  if (!v) throw new Error(`Invalid value "${value}" for ${name}. Allowed: ${ENUMS[name].map(label).join(", ")}`);
  return v;
}
