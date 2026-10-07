// Role-based access control shared by server (API enforcement) and client (UI gating).

// super_admin is shown as "Admin"; the key stays because code and existing data rely on it
export const ROLES = ["super_admin", "manager", "pharmacist", "developer", "marketing", "customer_support"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: "Admin",
  manager: "Manager",
  pharmacist: "Pharmacist",
  developer: "Developer",
  marketing: "Marketing",
  customer_support: "Customer Support",
};

/** Role key from a key ("customer_support") or label ("Customer Support"); undefined if unknown. */
export const roleKey = (v: unknown): Role | undefined =>
  ROLES.find((r) => r === v || ROLE_LABELS[r].toLowerCase() === String(v ?? "").trim().toLowerCase());

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

// Self-service: own profile, leave, attendance, payslips, expenses, documents and helpdesk
const SELF: PermissionMatrix = {
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
};

export const PERMISSIONS: Record<Role, PermissionMatrix> = {
  super_admin: Object.fromEntries(ALL_RESOURCES.map((r) => [r, g("*")])),

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

  pharmacist: SELF,
  developer: SELF,
  marketing: {
    ...SELF,
    announcements: g("view,create,edit,delete"),
    recognitions: g("view,create,edit"),
    surveys: g("view,create,edit"),
  },
  customer_support: {
    ...SELF,
    tickets: g("view,create,edit,approve,export"),
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

/** HR work (payroll, balances, exits) is done by Admin. */
export const isHR = (role?: Role) => role === "super_admin";

/** Resources whose permissions can be configured in the roles/role_permissions tables. */
export const ALL_RESOURCE_KEYS = Object.keys(PERMISSIONS.super_admin) as Resource[];
