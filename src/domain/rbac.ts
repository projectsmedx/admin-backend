// Role-based access control shared by server (API enforcement) and client (UI gating).

export const ROLES = ["super_admin", "hr_admin", "hr_manager", "finance", "manager", "employee"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: "Super Admin",
  hr_admin: "HR Admin",
  hr_manager: "HR Manager",
  finance: "Finance",
  manager: "Manager",
  employee: "Employee",
};

export const ACTIONS = ["view", "create", "edit", "delete", "approve", "export", "manage"] as const;
export type Action = (typeof ACTIONS)[number];

export const SCOPES = ["own", "team", "department", "all"] as const;
export type Scope = (typeof SCOPES)[number];

export type Resource =
  | "dashboard" | "employees" | "compensation" | "departments" | "designations" | "locations"
  | "shifts" | "holidays" | "leaveTypes" | "leaves" | "attendance" | "attendanceCorrections" | "timesheets"
  | "documents" | "payrollRuns" | "loans" | "salaryRevisions" | "settlements"
  | "jobs" | "candidates" | "interviews" | "offers" | "onboarding"
  | "goals" | "reviews" | "kpis" | "expenses" | "assets" | "trainings" | "tickets"
  | "announcements" | "offboarding" | "cases" | "recognitions" | "surveys"
  | "auditLogs" | "users" | "settings" | "reports" | "analytics";

export interface Grant {
  actions: Action[];
  scope: Scope;
}
export type PermissionMatrix = Partial<Record<Resource, Grant>>;

const g = (actions: string, scope: Scope = "all"): Grant => ({
  actions: (actions === "*" ? [...ACTIONS] : actions.split(",").map((a) => a.trim())) as Action[],
  scope,
});

// Reference data everyone can read
const COMMON: PermissionMatrix = {
  dashboard: g("view"),
  departments: g("view"),
  designations: g("view"),
  locations: g("view"),
  shifts: g("view"),
  holidays: g("view"),
  leaveTypes: g("view"),
  announcements: g("view"),
  trainings: g("view"),
  recognitions: g("view"),
  surveys: g("view"),
};

const ALL_RESOURCES: Resource[] = [
  "dashboard", "employees", "compensation", "departments", "designations", "locations", "shifts", "holidays", "leaveTypes",
  "leaves", "attendance", "attendanceCorrections", "timesheets", "documents", "payrollRuns", "loans", "salaryRevisions",
  "settlements", "jobs", "candidates", "interviews", "offers", "onboarding", "goals", "reviews", "kpis", "expenses",
  "assets", "trainings", "tickets", "announcements", "offboarding", "cases", "recognitions", "surveys", "auditLogs",
  "users", "settings", "reports", "analytics",
];

const HR_CORE = "view,create,edit,delete,approve,export";

export const PERMISSIONS: Record<Role, PermissionMatrix> = {
  super_admin: Object.fromEntries(ALL_RESOURCES.map((r) => [r, g("*")])),

  hr_admin: {
    ...COMMON,
    employees: g(HR_CORE),
    compensation: g("view"),
    departments: g("view,create,edit,delete"),
    designations: g("view,create,edit,delete"),
    locations: g("view,create,edit"),
    shifts: g("view,create,edit,delete"),
    holidays: g("view,create,edit,delete"),
    leaveTypes: g("view,create,edit"),
    leaves: g(HR_CORE),
    attendance: g(HR_CORE),
    attendanceCorrections: g("view,create,edit,approve"),
    timesheets: g("view,approve,export"),
    documents: g(HR_CORE),
    payrollRuns: g("view"),
    salaryRevisions: g("view,create"),
    jobs: g(HR_CORE),
    candidates: g(HR_CORE),
    interviews: g(HR_CORE),
    offers: g(HR_CORE),
    onboarding: g(HR_CORE),
    goals: g("view,create,edit"),
    reviews: g("view,create,edit"),
    kpis: g("view,create,edit"),
    expenses: g("view,create"),
    assets: g("view,create,edit,delete,export"),
    trainings: g("view,create,edit,delete"),
    tickets: g(HR_CORE),
    announcements: g("view,create,edit,delete"),
    offboarding: g(HR_CORE),
    cases: g("view,create,edit"),
    recognitions: g("view,create,edit,delete"),
    surveys: g("view,create,edit"),
    reports: g("view,export"),
  },

  hr_manager: {
    ...COMMON,
    employees: g(HR_CORE),
    compensation: g("view,edit"),
    departments: g("view,create,edit,delete"),
    designations: g("view,create,edit,delete"),
    locations: g("view,create,edit,delete"),
    shifts: g("view,create,edit,delete"),
    holidays: g("view,create,edit,delete"),
    leaveTypes: g("view,create,edit,delete"),
    leaves: g(HR_CORE),
    attendance: g(HR_CORE),
    attendanceCorrections: g("view,create,edit,approve"),
    timesheets: g("view,approve,export"),
    documents: g(HR_CORE),
    payrollRuns: g("view,approve,export"),
    loans: g("view,approve"),
    salaryRevisions: g("view,create,edit,approve"),
    settlements: g("view,create,approve"),
    jobs: g(HR_CORE),
    candidates: g(HR_CORE),
    interviews: g(HR_CORE),
    offers: g(HR_CORE),
    onboarding: g(HR_CORE),
    goals: g(HR_CORE),
    reviews: g(HR_CORE),
    kpis: g(HR_CORE),
    expenses: g("view,approve,export"),
    assets: g("view,create,edit,export"),
    trainings: g("view,create,edit,delete"),
    tickets: g(HR_CORE),
    announcements: g("view,create,edit,delete"),
    offboarding: g(HR_CORE),
    cases: g("*"),
    recognitions: g("view,create,edit,delete"),
    surveys: g("view,create,edit,delete"),
    auditLogs: g("view,export"),
    users: g("view"),
    settings: g("view,edit"),
    reports: g("view,export"),
    analytics: g("view"),
  },

  finance: {
    ...COMMON,
    employees: g("view,export"),
    compensation: g("view,edit"),
    attendance: g("view,export"),
    leaves: g("view"),
    payrollRuns: g("*"),
    loans: g(HR_CORE),
    salaryRevisions: g("view,approve,export"),
    settlements: g(HR_CORE),
    expenses: g(HR_CORE),
    assets: g("view,export"),
    timesheets: g("view,export"),
    documents: g("view", "own"),
    tickets: g("view,create", "own"),
    goals: g("view", "own"),
    reports: g("view,export"),
    analytics: g("view"),
  },

  manager: {
    ...COMMON,
    employees: g("view", "team"),
    leaves: g("view,create,approve", "team"),
    attendance: g("view,create,export", "team"),
    attendanceCorrections: g("view,create,approve", "team"),
    timesheets: g("view,create,approve", "team"),
    documents: g("view,create", "team"),
    payrollRuns: g("view", "own"),
    goals: g("view,create,edit", "team"),
    reviews: g("view,edit,approve", "team"),
    kpis: g("view,create,edit", "team"),
    expenses: g("view,create,approve", "team"),
    jobs: g("view,create"),
    candidates: g("view,edit"),
    interviews: g("view,edit"),
    onboarding: g("view,edit", "team"),
    assets: g("view", "team"),
    tickets: g("view,create", "own"),
    salaryRevisions: g("view,create", "team"),
    offboarding: g("view,approve", "team"),
    recognitions: g("view,create"),
    loans: g("view", "own"),
    reports: g("view", "team"),
  },

  employee: {
    ...COMMON,
    employees: g("view,edit", "own"),
    leaves: g("view,create,edit", "own"),
    attendance: g("view,create", "own"),
    attendanceCorrections: g("view,create", "own"),
    timesheets: g("view,create,edit", "own"),
    documents: g("view,create", "own"),
    payrollRuns: g("view", "own"),
    loans: g("view", "own"),
    goals: g("view,edit", "own"),
    reviews: g("view,edit", "own"),
    kpis: g("view", "own"),
    expenses: g("view,create", "own"),
    assets: g("view", "own"),
    tickets: g("view,create,edit", "own"),
    offboarding: g("view,create", "own"),
    salaryRevisions: g("view", "own"),
    onboarding: g("view,edit", "own"),
  },
};

export function grantFor(role: Role, resource: Resource): Grant | undefined {
  return PERMISSIONS[role]?.[resource];
}

export function can(role: Role | undefined, resource: Resource, action: Action = "view"): boolean {
  if (!role) return false;
  return !!grantFor(role, resource)?.actions.includes(action);
}

export function scopeOf(role: Role, resource: Resource): Scope | null {
  return grantFor(role, resource)?.scope ?? null;
}

export const isHR = (role?: Role) => role === "super_admin" || role === "hr_admin" || role === "hr_manager";

/** Resources whose permissions can be configured in the roles/role_permissions tables. */
export const ALL_RESOURCE_KEYS = Object.keys(PERMISSIONS.super_admin) as Resource[];
