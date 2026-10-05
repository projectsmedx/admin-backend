-- MedxDashboard — PostgreSQL 16 schema
-- Generated from docs/build/spec.mjs. 72 tables, 30 enum types.
-- Use as the reference for Prisma/TypeORM models or apply directly: psql -f schema.sql

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;    -- case-insensitive emails

-- Enum types
CREATE TYPE user_role AS ENUM ('super_admin', 'hr_admin', 'hr_manager', 'finance', 'manager', 'employee');
CREATE TYPE access_scope AS ENUM ('own', 'team', 'department', 'all');
CREATE TYPE gender AS ENUM ('male', 'female');
CREATE TYPE employment_type AS ENUM ('full_time', 'part_time', 'contract', 'intern');
CREATE TYPE work_mode AS ENUM ('office', 'hybrid', 'remote');
CREATE TYPE employee_status AS ENUM ('active', 'probation', 'on_leave', 'notice_period', 'resigned', 'terminated');
CREATE TYPE job_status AS ENUM ('draft', 'pending_approval', 'open', 'on_hold', 'closed');
CREATE TYPE candidate_stage AS ENUM ('applied', 'screening', 'shortlisted', 'interview', 'technical_interview', 'hr_interview', 'offer', 'hired', 'rejected');
CREATE TYPE interview_status AS ENUM ('scheduled', 'completed', 'cancelled', 'no_show');
CREATE TYPE offer_status AS ENUM ('draft', 'sent', 'accepted', 'declined');
CREATE TYPE onboarding_stage AS ENUM ('offer_accepted', 'documents_collection', 'hr_verification', 'it_setup', 'manager_setup', 'employee_joining', 'onboarding_complete');
CREATE TYPE shift_type AS ENUM ('morning', 'evening', 'night', 'flexible', 'rotational', 'remote');
CREATE TYPE attendance_status AS ENUM ('present', 'late', 'absent', 'half_day', 'remote', 'on_leave', 'holiday');
CREATE TYPE request_status AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE timesheet_status AS ENUM ('draft', 'submitted', 'approved', 'rejected');
CREATE TYPE leave_status AS ENUM ('pending', 'manager_approved', 'approved', 'rejected', 'cancelled');
CREATE TYPE holiday_type AS ENUM ('public', 'company', 'department', 'custom');
CREATE TYPE payroll_status AS ENUM ('draft', 'approved', 'locked', 'paid');
CREATE TYPE loan_type AS ENUM ('loan', 'advance');
CREATE TYPE settlement_status AS ENUM ('draft', 'approved', 'paid');
CREATE TYPE goal_level AS ENUM ('company', 'department', 'employee');
CREATE TYPE goal_status AS ENUM ('not_started', 'in_progress', 'on_track', 'at_risk', 'completed');
CREATE TYPE review_status AS ENUM ('not_started', 'self_review', 'manager_review', 'completed');
CREATE TYPE expense_status AS ENUM ('pending', 'manager_approved', 'approved', 'reimbursed', 'rejected');
CREATE TYPE document_category AS ENUM ('identity', 'employment', 'visa', 'education', 'certifications', 'payroll', 'performance', 'medical', 'insurance', 'company');
CREATE TYPE document_status AS ENUM ('verified', 'pending_verification', 'rejected');
CREATE TYPE asset_status AS ENUM ('in_stock', 'assigned', 'maintenance', 'returned', 'retired');
CREATE TYPE priority AS ENUM ('low', 'medium', 'high', 'urgent');
CREATE TYPE ticket_status AS ENUM ('open', 'in_progress', 'resolved', 'closed');
CREATE TYPE exit_stage AS ENUM ('submitted', 'hr_review', 'notice_period', 'completed', 'withdrawn');

-- Keeps updated_at current
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- =============================================================== Authentication & Security
-- Login accounts. One user optionally links to one employee.
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role user_role DEFAULT 'employee' NOT NULL,
  employee_id uuid UNIQUE,
  display_name text,
  is_active boolean DEFAULT true NOT NULL,
  failed_attempts smallint DEFAULT 0 NOT NULL,
  locked_until timestamptz,
  last_login_at timestamptz,
  last_login_ip inet,
  mfa_enabled boolean DEFAULT false NOT NULL,
  mfa_secret text,
  password_changed_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN users.id IS 'Primary key';
COMMENT ON COLUMN users.email IS 'Login email';
COMMENT ON COLUMN users.password_hash IS 'bcrypt/argon2 hash';
COMMENT ON COLUMN users.role IS 'Enum: super_admin, hr_admin, hr_manager, finance, manager, employee';
COMMENT ON COLUMN users.employee_id IS 'Linked employee profile (nullable for service accounts)';
COMMENT ON COLUMN users.display_name IS 'Name shown in the UI';
COMMENT ON COLUMN users.is_active IS 'Deactivated users cannot sign in';
COMMENT ON COLUMN users.failed_attempts IS 'Consecutive failed logins';
COMMENT ON COLUMN users.locked_until IS 'Lockout expiry';
COMMENT ON COLUMN users.mfa_secret IS 'Encrypted TOTP secret';
COMMENT ON COLUMN users.password_changed_at IS 'For password-expiry policy';
COMMENT ON COLUMN users.created_at IS 'Row creation time';
COMMENT ON COLUMN users.updated_at IS 'Last update time';
COMMENT ON TABLE users IS 'Login accounts. One user optionally links to one employee.';
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Rotating refresh tokens / active sessions.
CREATE TABLE refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE,
  user_agent text,
  ip inet,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN refresh_tokens.id IS 'Primary key';
COMMENT ON COLUMN refresh_tokens.token_hash IS 'SHA-256 of the token';
COMMENT ON COLUMN refresh_tokens.created_at IS 'Row creation time';
COMMENT ON COLUMN refresh_tokens.updated_at IS 'Last update time';
COMMENT ON TABLE refresh_tokens IS 'Rotating refresh tokens / active sessions.';
CREATE TRIGGER trg_refresh_tokens_updated BEFORE UPDATE ON refresh_tokens FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Role catalog (seeded with the six system roles; custom roles optional).
CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  is_system boolean DEFAULT true NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN roles.id IS 'Primary key';
COMMENT ON COLUMN roles.key IS 'e.g. hr_manager';
COMMENT ON COLUMN roles.is_system IS 'System roles cannot be deleted';
COMMENT ON COLUMN roles.created_at IS 'Row creation time';
COMMENT ON COLUMN roles.updated_at IS 'Last update time';
COMMENT ON TABLE roles IS 'Role catalog (seeded with the six system roles; custom roles optional).';
CREATE TRIGGER trg_roles_updated BEFORE UPDATE ON roles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Permission matrix: which actions a role has on a resource, and in which scope.
CREATE TABLE role_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id uuid NOT NULL,
  resource text NOT NULL,
  actions text[] NOT NULL,
  scope access_scope DEFAULT 'own' NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (role_id, resource)
);
COMMENT ON COLUMN role_permissions.id IS 'Primary key';
COMMENT ON COLUMN role_permissions.resource IS 'e.g. leaves, payrollRuns, compensation';
COMMENT ON COLUMN role_permissions.actions IS 'Subset of view, create, edit, delete, approve, export, manage';
COMMENT ON COLUMN role_permissions.scope IS 'Enum: own, team, department, all';
COMMENT ON COLUMN role_permissions.created_at IS 'Row creation time';
COMMENT ON COLUMN role_permissions.updated_at IS 'Last update time';
COMMENT ON TABLE role_permissions IS 'Permission matrix: which actions a role has on a resource, and in which scope.';
CREATE TRIGGER trg_role_permissions_updated BEFORE UPDATE ON role_permissions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================== Employee Management
-- Employee master record.
CREATE TABLE employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  first_name text NOT NULL,
  last_name text NOT NULL,
  work_email citext NOT NULL UNIQUE,
  personal_email citext,
  phone text,
  gender gender,
  date_of_birth date,
  nationality text,
  marital_status text,
  address text,
  department_id uuid NOT NULL,
  designation_id uuid NOT NULL,
  team_id uuid,
  manager_id uuid,
  location_id uuid,
  employment_type employment_type NOT NULL,
  work_mode work_mode DEFAULT 'office' NOT NULL,
  status employee_status DEFAULT 'probation' NOT NULL,
  joining_date date NOT NULL,
  probation_end_date date,
  confirmation_date date,
  last_working_day date,
  notice_period_days smallint DEFAULT 30 NOT NULL,
  emirates_id text,
  passport_number text,
  labour_card_number text,
  avatar_file_id uuid,
  avatar_color text,
  deleted_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN employees.id IS 'Primary key';
COMMENT ON COLUMN employees.code IS 'Human-readable ID, e.g. EMP-1001';
COMMENT ON COLUMN employees.gender IS 'Enum: male, female';
COMMENT ON COLUMN employees.nationality IS 'ISO country name or code';
COMMENT ON COLUMN employees.manager_id IS 'Reporting manager (self-reference)';
COMMENT ON COLUMN employees.location_id IS 'Work location / branch';
COMMENT ON COLUMN employees.employment_type IS 'Enum: full_time, part_time, contract, intern';
COMMENT ON COLUMN employees.work_mode IS 'Enum: office, hybrid, remote';
COMMENT ON COLUMN employees.status IS 'Enum: active, probation, on_leave, notice_period, resigned, terminated';
COMMENT ON COLUMN employees.last_working_day IS 'Set when exiting';
COMMENT ON COLUMN employees.emirates_id IS 'Encrypt at rest; masked in API';
COMMENT ON COLUMN employees.passport_number IS 'Encrypt at rest; masked in API';
COMMENT ON COLUMN employees.labour_card_number IS 'MOHRE work permit / labour card (WPS)';
COMMENT ON COLUMN employees.avatar_color IS 'UI accent when no photo';
COMMENT ON COLUMN employees.deleted_at IS 'Soft delete';
COMMENT ON COLUMN employees.created_at IS 'Row creation time';
COMMENT ON COLUMN employees.updated_at IS 'Last update time';
COMMENT ON TABLE employees IS 'Employee master record.';
CREATE TRIGGER trg_employees_updated BEFORE UPDATE ON employees FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Emergency contacts (one or more per employee).
CREATE TABLE employee_emergency_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  name text NOT NULL,
  relation text,
  phone text NOT NULL,
  is_primary boolean DEFAULT true NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN employee_emergency_contacts.id IS 'Primary key';
COMMENT ON COLUMN employee_emergency_contacts.employee_id IS 'Employee';
COMMENT ON COLUMN employee_emergency_contacts.created_at IS 'Row creation time';
COMMENT ON COLUMN employee_emergency_contacts.updated_at IS 'Last update time';
COMMENT ON TABLE employee_emergency_contacts IS 'Emergency contacts (one or more per employee).';
CREATE TRIGGER trg_employee_emergency_contacts_updated BEFORE UPDATE ON employee_emergency_contacts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Salary account used for WPS.
CREATE TABLE employee_bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  bank_name text NOT NULL,
  iban text NOT NULL,
  routing_code text,
  is_primary boolean DEFAULT true NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN employee_bank_accounts.id IS 'Primary key';
COMMENT ON COLUMN employee_bank_accounts.employee_id IS 'Employee';
COMMENT ON COLUMN employee_bank_accounts.iban IS 'Encrypted; masked in API';
COMMENT ON COLUMN employee_bank_accounts.routing_code IS 'WPS agent/bank routing code';
COMMENT ON COLUMN employee_bank_accounts.created_at IS 'Row creation time';
COMMENT ON COLUMN employee_bank_accounts.updated_at IS 'Last update time';
COMMENT ON TABLE employee_bank_accounts IS 'Salary account used for WPS.';
CREATE TRIGGER trg_employee_bank_accounts_updated BEFORE UPDATE ON employee_bank_accounts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Skills per employee.
CREATE TABLE employee_skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  skill text NOT NULL,
  level smallint,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (employee_id, skill)
);
COMMENT ON COLUMN employee_skills.id IS 'Primary key';
COMMENT ON COLUMN employee_skills.employee_id IS 'Employee';
COMMENT ON COLUMN employee_skills.level IS '1–5';
COMMENT ON COLUMN employee_skills.created_at IS 'Row creation time';
COMMENT ON COLUMN employee_skills.updated_at IS 'Last update time';
COMMENT ON TABLE employee_skills IS 'Skills per employee.';
CREATE TRIGGER trg_employee_skills_updated BEFORE UPDATE ON employee_skills FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Effective-dated salary components. The row with effective_to = null is current.
CREATE TABLE salary_structures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  basic numeric(12,2) NOT NULL,
  housing numeric(12,2) DEFAULT 0 NOT NULL,
  transport numeric(12,2) DEFAULT 0 NOT NULL,
  medical numeric(12,2) DEFAULT 0 NOT NULL,
  other_allowances numeric(12,2) DEFAULT 0 NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  salary_revision_id uuid,
  created_by uuid,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN salary_structures.id IS 'Primary key';
COMMENT ON COLUMN salary_structures.employee_id IS 'Employee';
COMMENT ON COLUMN salary_structures.basic IS 'AED / month';
COMMENT ON COLUMN salary_structures.salary_revision_id IS 'Revision that created this row';
COMMENT ON COLUMN salary_structures.created_by IS 'User who created the record';
COMMENT ON COLUMN salary_structures.created_at IS 'Row creation time';
COMMENT ON COLUMN salary_structures.updated_at IS 'Last update time';
COMMENT ON TABLE salary_structures IS 'Effective-dated salary components. The row with effective_to = null is current.';
CREATE TRIGGER trg_salary_structures_updated BEFORE UPDATE ON salary_structures FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================== Organization Structure
-- Single-row company profile (legal entity).
CREATE TABLE company (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  legal_name text,
  trade_license text,
  trn text,
  mol_establishment_id text,
  email text,
  phone text,
  website text,
  address text,
  currency char(3) DEFAULT 'AED' NOT NULL,
  timezone text DEFAULT 'Asia/Dubai' NOT NULL,
  weekend_days smallint[] DEFAULT '{6,0}' NOT NULL,
  logo_file_id uuid,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN company.id IS 'Primary key';
COMMENT ON COLUMN company.trn IS 'VAT TRN';
COMMENT ON COLUMN company.mol_establishment_id IS 'MOHRE establishment ID for WPS';
COMMENT ON COLUMN company.weekend_days IS '0=Sunday…6=Saturday';
COMMENT ON COLUMN company.created_at IS 'Row creation time';
COMMENT ON COLUMN company.updated_at IS 'Last update time';
COMMENT ON TABLE company IS 'Single-row company profile (legal entity).';
CREATE TRIGGER trg_company_updated BEFORE UPDATE ON company FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Branches / work locations.
CREATE TABLE locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  city text NOT NULL,
  country text DEFAULT 'UAE' NOT NULL,
  address text,
  timezone text DEFAULT 'Asia/Dubai' NOT NULL,
  latitude numeric(9,6),
  longitude numeric(9,6),
  geofence_radius_m integer,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN locations.id IS 'Primary key';
COMMENT ON COLUMN locations.latitude IS 'For GPS check-in geofence';
COMMENT ON COLUMN locations.created_at IS 'Row creation time';
COMMENT ON COLUMN locations.updated_at IS 'Last update time';
COMMENT ON TABLE locations IS 'Branches / work locations.';
CREATE TRIGGER trg_locations_updated BEFORE UPDATE ON locations FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Departments.
CREATE TABLE departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  code text NOT NULL UNIQUE,
  manager_id uuid,
  parent_id uuid,
  location_id uuid,
  cost_center text,
  budget numeric(14,2),
  description text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN departments.id IS 'Primary key';
COMMENT ON COLUMN departments.parent_id IS 'Optional sub-departments';
COMMENT ON COLUMN departments.budget IS 'Annual budget AED';
COMMENT ON COLUMN departments.created_at IS 'Row creation time';
COMMENT ON COLUMN departments.updated_at IS 'Last update time';
COMMENT ON TABLE departments IS 'Departments.';
CREATE TRIGGER trg_departments_updated BEFORE UPDATE ON departments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Teams within departments.
CREATE TABLE teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL,
  name text NOT NULL,
  lead_id uuid,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN teams.id IS 'Primary key';
COMMENT ON COLUMN teams.created_at IS 'Row creation time';
COMMENT ON COLUMN teams.updated_at IS 'Last update time';
COMMENT ON TABLE teams IS 'Teams within departments.';
CREATE TRIGGER trg_teams_updated BEFORE UPDATE ON teams FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Job titles, levels and salary bands.
CREATE TABLE designations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  level text NOT NULL,
  department_id uuid,
  min_salary numeric(12,2),
  max_salary numeric(12,2),
  required_skills text[] DEFAULT '{}' NOT NULL,
  description text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN designations.id IS 'Primary key';
COMMENT ON COLUMN designations.level IS 'L1–L8';
COMMENT ON COLUMN designations.created_at IS 'Row creation time';
COMMENT ON COLUMN designations.updated_at IS 'Last update time';
COMMENT ON TABLE designations IS 'Job titles, levels and salary bands.';
CREATE TRIGGER trg_designations_updated BEFORE UPDATE ON designations FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================== Recruitment / ATS
-- Job openings.
CREATE TABLE job_requisitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  title text NOT NULL,
  department_id uuid NOT NULL,
  designation_id uuid,
  location_id uuid,
  employment_type employment_type NOT NULL,
  vacancies smallint DEFAULT 1 NOT NULL,
  min_salary numeric(12,2),
  max_salary numeric(12,2),
  experience text,
  skills text[] DEFAULT '{}' NOT NULL,
  description text,
  hiring_manager_id uuid,
  status job_status DEFAULT 'pending_approval' NOT NULL,
  posted_date date,
  closing_date date,
  created_by uuid,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN job_requisitions.id IS 'Primary key';
COMMENT ON COLUMN job_requisitions.code IS 'JOB-1';
COMMENT ON COLUMN job_requisitions.status IS 'Enum: draft, pending_approval, open, on_hold, closed';
COMMENT ON COLUMN job_requisitions.created_by IS 'User who created the record';
COMMENT ON COLUMN job_requisitions.created_at IS 'Row creation time';
COMMENT ON COLUMN job_requisitions.updated_at IS 'Last update time';
COMMENT ON TABLE job_requisitions IS 'Job openings.';
CREATE TRIGGER trg_job_requisitions_updated BEFORE UPDATE ON job_requisitions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Applicants (one row per application).
CREATE TABLE candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  job_id uuid NOT NULL,
  full_name text NOT NULL,
  email citext NOT NULL,
  phone text,
  stage candidate_stage DEFAULT 'applied' NOT NULL,
  source text,
  experience_years numeric(4,1),
  current_company text,
  expected_salary numeric(12,2),
  notice_period text,
  education text,
  skills text[] DEFAULT '{}' NOT NULL,
  tags text[] DEFAULT '{}' NOT NULL,
  rating smallint,
  recruiter_id uuid,
  resume_file_id uuid,
  notes text,
  rejection_reason text,
  applied_date date DEFAULT current_date NOT NULL,
  employee_id uuid,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN candidates.id IS 'Primary key';
COMMENT ON COLUMN candidates.code IS 'CAN-1';
COMMENT ON COLUMN candidates.stage IS 'Enum: applied, screening, shortlisted, interview, technical_interview, hr_interview, offer, hired, rejected';
COMMENT ON COLUMN candidates.source IS 'LinkedIn, Bayt, Referral…';
COMMENT ON COLUMN candidates.rating IS '1–5';
COMMENT ON COLUMN candidates.employee_id IS 'Set when converted to employee';
COMMENT ON COLUMN candidates.created_at IS 'Row creation time';
COMMENT ON COLUMN candidates.updated_at IS 'Last update time';
COMMENT ON TABLE candidates IS 'Applicants (one row per application).';
CREATE TRIGGER trg_candidates_updated BEFORE UPDATE ON candidates FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Every stage change (for time-to-hire and funnel analytics).
CREATE TABLE candidate_stage_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL,
  from_stage candidate_stage,
  to_stage candidate_stage NOT NULL,
  changed_by uuid,
  reason text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN candidate_stage_history.id IS 'Primary key';
COMMENT ON COLUMN candidate_stage_history.created_at IS 'Row creation time';
COMMENT ON COLUMN candidate_stage_history.updated_at IS 'Last update time';
COMMENT ON TABLE candidate_stage_history IS 'Every stage change (for time-to-hire and funnel analytics).';
CREATE TRIGGER trg_candidate_stage_history_updated BEFORE UPDATE ON candidate_stage_history FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Interview schedule and scorecards.
CREATE TABLE interviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL,
  job_id uuid NOT NULL,
  round text NOT NULL,
  scheduled_at timestamptz NOT NULL,
  mode text NOT NULL,
  interviewer_id uuid NOT NULL,
  status interview_status DEFAULT 'scheduled' NOT NULL,
  score smallint,
  recommendation text,
  feedback text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN interviews.id IS 'Primary key';
COMMENT ON COLUMN interviews.round IS 'First, Technical, HR, Final';
COMMENT ON COLUMN interviews.mode IS 'Onsite, Video Call, Phone';
COMMENT ON COLUMN interviews.status IS 'Enum: scheduled, completed, cancelled, no_show';
COMMENT ON COLUMN interviews.score IS '1–10';
COMMENT ON COLUMN interviews.recommendation IS 'Strong Hire, Hire, Maybe, No Hire';
COMMENT ON COLUMN interviews.created_at IS 'Row creation time';
COMMENT ON COLUMN interviews.updated_at IS 'Last update time';
COMMENT ON TABLE interviews IS 'Interview schedule and scorecards.';
CREATE TRIGGER trg_interviews_updated BEFORE UPDATE ON interviews FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Offer letters.
CREATE TABLE offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL,
  job_id uuid NOT NULL,
  salary numeric(12,2) NOT NULL,
  joining_date date NOT NULL,
  expiry_date date,
  status offer_status DEFAULT 'draft' NOT NULL,
  sent_at timestamptz,
  letter_file_id uuid,
  notes text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN offers.id IS 'Primary key';
COMMENT ON COLUMN offers.salary IS 'Monthly package AED';
COMMENT ON COLUMN offers.status IS 'Enum: draft, sent, accepted, declined';
COMMENT ON COLUMN offers.letter_file_id IS 'Generated PDF';
COMMENT ON COLUMN offers.created_at IS 'Row creation time';
COMMENT ON COLUMN offers.updated_at IS 'Last update time';
COMMENT ON TABLE offers IS 'Offer letters.';
CREATE TRIGGER trg_offers_updated BEFORE UPDATE ON offers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================== Onboarding
-- Reusable checklist template.
CREATE TABLE onboarding_task_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  category text NOT NULL,
  owner_role text NOT NULL,
  due_offset_days smallint DEFAULT 0 NOT NULL,
  sort_order smallint DEFAULT 0 NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN onboarding_task_templates.id IS 'Primary key';
COMMENT ON COLUMN onboarding_task_templates.category IS 'Documents, HR, IT, Manager, Employee, Admin';
COMMENT ON COLUMN onboarding_task_templates.owner_role IS 'Who completes it';
COMMENT ON COLUMN onboarding_task_templates.due_offset_days IS 'Relative to joining date';
COMMENT ON COLUMN onboarding_task_templates.created_at IS 'Row creation time';
COMMENT ON COLUMN onboarding_task_templates.updated_at IS 'Last update time';
COMMENT ON TABLE onboarding_task_templates IS 'Reusable checklist template.';
CREATE TRIGGER trg_onboarding_task_templates_updated BEFORE UPDATE ON onboarding_task_templates FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One onboarding per employee.
CREATE TABLE onboarding_processes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  start_date date NOT NULL,
  buddy_id uuid,
  stage onboarding_stage DEFAULT 'offer_accepted' NOT NULL,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (employee_id)
);
COMMENT ON COLUMN onboarding_processes.id IS 'Primary key';
COMMENT ON COLUMN onboarding_processes.employee_id IS 'New joiner';
COMMENT ON COLUMN onboarding_processes.stage IS 'Enum of the 7 workflow stages';
COMMENT ON COLUMN onboarding_processes.created_at IS 'Row creation time';
COMMENT ON COLUMN onboarding_processes.updated_at IS 'Last update time';
COMMENT ON TABLE onboarding_processes IS 'One onboarding per employee.';
CREATE TRIGGER trg_onboarding_processes_updated BEFORE UPDATE ON onboarding_processes FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Checklist items for a process.
CREATE TABLE onboarding_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  process_id uuid NOT NULL,
  template_id uuid,
  title text NOT NULL,
  category text NOT NULL,
  owner_role text,
  assignee_id uuid,
  due_date date,
  is_done boolean DEFAULT false NOT NULL,
  done_at timestamptz,
  done_by uuid,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN onboarding_tasks.id IS 'Primary key';
COMMENT ON COLUMN onboarding_tasks.created_at IS 'Row creation time';
COMMENT ON COLUMN onboarding_tasks.updated_at IS 'Last update time';
COMMENT ON TABLE onboarding_tasks IS 'Checklist items for a process.';
CREATE TRIGGER trg_onboarding_tasks_updated BEFORE UPDATE ON onboarding_tasks FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================== Attendance, Timesheets & Shifts
-- Shift templates.
CREATE TABLE shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  type shift_type NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  break_minutes smallint DEFAULT 60 NOT NULL,
  grace_minutes smallint DEFAULT 15 NOT NULL,
  working_days smallint[] DEFAULT '{1,2,3,4,5}' NOT NULL,
  color text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN shifts.id IS 'Primary key';
COMMENT ON COLUMN shifts.type IS 'Enum: morning, evening, night, flexible, rotational, remote';
COMMENT ON COLUMN shifts.working_days IS '0=Sunday…6=Saturday';
COMMENT ON COLUMN shifts.created_at IS 'Row creation time';
COMMENT ON COLUMN shifts.updated_at IS 'Last update time';
COMMENT ON TABLE shifts IS 'Shift templates.';
CREATE TRIGGER trg_shifts_updated BEFORE UPDATE ON shifts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Which shift an employee works, effective-dated (supports rotations).
CREATE TABLE shift_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  shift_id uuid NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN shift_assignments.id IS 'Primary key';
COMMENT ON COLUMN shift_assignments.employee_id IS 'Employee';
COMMENT ON COLUMN shift_assignments.created_at IS 'Row creation time';
COMMENT ON COLUMN shift_assignments.updated_at IS 'Last update time';
COMMENT ON TABLE shift_assignments IS 'Which shift an employee works, effective-dated (supports rotations).';
CREATE TRIGGER trg_shift_assignments_updated BEFORE UPDATE ON shift_assignments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One row per employee per day.
CREATE TABLE attendance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  work_date date NOT NULL,
  check_in_at timestamptz,
  check_out_at timestamptz,
  status attendance_status NOT NULL,
  worked_hours numeric(5,2) DEFAULT 0 NOT NULL,
  overtime_hours numeric(5,2) DEFAULT 0 NOT NULL,
  method text,
  location text,
  ip inet,
  notes text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (employee_id, work_date)
);
COMMENT ON COLUMN attendance_records.id IS 'Primary key';
COMMENT ON COLUMN attendance_records.employee_id IS 'Employee';
COMMENT ON COLUMN attendance_records.status IS 'Enum: present, late, absent, half_day, remote, on_leave, holiday';
COMMENT ON COLUMN attendance_records.worked_hours IS 'After break';
COMMENT ON COLUMN attendance_records.method IS 'Web, Mobile, GPS, QR, Biometric, Correction';
COMMENT ON COLUMN attendance_records.location IS 'GPS coordinates or device ID';
COMMENT ON COLUMN attendance_records.created_at IS 'Row creation time';
COMMENT ON COLUMN attendance_records.updated_at IS 'Last update time';
COMMENT ON TABLE attendance_records IS 'One row per employee per day.';
CREATE TRIGGER trg_attendance_records_updated BEFORE UPDATE ON attendance_records FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Missed-punch / correction requests.
CREATE TABLE attendance_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  work_date date NOT NULL,
  requested_check_in time NOT NULL,
  requested_check_out time NOT NULL,
  reason text NOT NULL,
  status request_status DEFAULT 'pending' NOT NULL,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN attendance_corrections.id IS 'Primary key';
COMMENT ON COLUMN attendance_corrections.employee_id IS 'Employee';
COMMENT ON COLUMN attendance_corrections.status IS 'Enum: pending, approved, rejected';
COMMENT ON COLUMN attendance_corrections.created_at IS 'Row creation time';
COMMENT ON COLUMN attendance_corrections.updated_at IS 'Last update time';
COMMENT ON TABLE attendance_corrections IS 'Missed-punch / correction requests.';
CREATE TRIGGER trg_attendance_corrections_updated BEFORE UPDATE ON attendance_corrections FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Projects for timesheets.
CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  code text UNIQUE,
  client text,
  is_billable boolean DEFAULT true NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN projects.id IS 'Primary key';
COMMENT ON COLUMN projects.created_at IS 'Row creation time';
COMMENT ON COLUMN projects.updated_at IS 'Last update time';
COMMENT ON TABLE projects IS 'Projects for timesheets.';
CREATE TRIGGER trg_projects_updated BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Hours logged per project/task.
CREATE TABLE timesheet_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  work_date date NOT NULL,
  project_id uuid NOT NULL,
  task text,
  hours numeric(4,2) NOT NULL,
  overtime_hours numeric(4,2) DEFAULT 0 NOT NULL,
  is_billable boolean DEFAULT true NOT NULL,
  status timesheet_status DEFAULT 'submitted' NOT NULL,
  notes text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN timesheet_entries.id IS 'Primary key';
COMMENT ON COLUMN timesheet_entries.employee_id IS 'Employee';
COMMENT ON COLUMN timesheet_entries.status IS 'Enum: draft, submitted, approved, rejected';
COMMENT ON COLUMN timesheet_entries.created_at IS 'Row creation time';
COMMENT ON COLUMN timesheet_entries.updated_at IS 'Last update time';
COMMENT ON TABLE timesheet_entries IS 'Hours logged per project/task.';
CREATE TRIGGER trg_timesheet_entries_updated BEFORE UPDATE ON timesheet_entries FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================== Leave & Holidays
-- Leave policy per type.
CREATE TABLE leave_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  code text NOT NULL UNIQUE,
  days_per_year numeric(5,1) NOT NULL,
  is_paid boolean DEFAULT true NOT NULL,
  accrual text DEFAULT 'upfront' NOT NULL,
  allow_carry_forward boolean DEFAULT false NOT NULL,
  max_carry_forward numeric(5,1) DEFAULT 0 NOT NULL,
  requires_document boolean DEFAULT false NOT NULL,
  allow_half_day boolean DEFAULT true NOT NULL,
  gender_restriction gender,
  color text,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN leave_types.id IS 'Primary key';
COMMENT ON COLUMN leave_types.code IS 'AL, SL…';
COMMENT ON COLUMN leave_types.accrual IS 'upfront | monthly';
COMMENT ON COLUMN leave_types.gender_restriction IS 'e.g. maternity';
COMMENT ON COLUMN leave_types.created_at IS 'Row creation time';
COMMENT ON COLUMN leave_types.updated_at IS 'Last update time';
COMMENT ON TABLE leave_types IS 'Leave policy per type.';
CREATE TRIGGER trg_leave_types_updated BEFORE UPDATE ON leave_types FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Opening entitlement per employee, type and year (used/pending are derived from requests).
CREATE TABLE leave_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  leave_type_id uuid NOT NULL,
  year smallint NOT NULL,
  entitled numeric(5,1) NOT NULL,
  carried_forward numeric(5,1) DEFAULT 0 NOT NULL,
  adjustment numeric(5,1) DEFAULT 0 NOT NULL,
  adjustment_note text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (employee_id, leave_type_id, year)
);
COMMENT ON COLUMN leave_balances.id IS 'Primary key';
COMMENT ON COLUMN leave_balances.employee_id IS 'Employee';
COMMENT ON COLUMN leave_balances.adjustment IS 'Manual HR adjustment';
COMMENT ON COLUMN leave_balances.created_at IS 'Row creation time';
COMMENT ON COLUMN leave_balances.updated_at IS 'Last update time';
COMMENT ON TABLE leave_balances IS 'Opening entitlement per employee, type and year (used/pending are derived from requests).';
CREATE TRIGGER trg_leave_balances_updated BEFORE UPDATE ON leave_balances FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Leave applications.
CREATE TABLE leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  employee_id uuid NOT NULL,
  leave_type_id uuid NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  days numeric(5,1) NOT NULL,
  is_half_day boolean DEFAULT false NOT NULL,
  reason text NOT NULL,
  attachment_file_id uuid,
  status leave_status DEFAULT 'pending' NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN leave_requests.id IS 'Primary key';
COMMENT ON COLUMN leave_requests.code IS 'LV-1';
COMMENT ON COLUMN leave_requests.employee_id IS 'Employee';
COMMENT ON COLUMN leave_requests.days IS 'Working days (0.5 for half day)';
COMMENT ON COLUMN leave_requests.status IS 'Enum: pending, manager_approved, approved, rejected, cancelled';
COMMENT ON COLUMN leave_requests.created_at IS 'Row creation time';
COMMENT ON COLUMN leave_requests.updated_at IS 'Last update time';
COMMENT ON TABLE leave_requests IS 'Leave applications.';
CREATE TRIGGER trg_leave_requests_updated BEFORE UPDATE ON leave_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Public / company holidays.
CREATE TABLE holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  holiday_date date NOT NULL,
  type holiday_type NOT NULL,
  country text DEFAULT 'UAE' NOT NULL,
  location_id uuid,
  department_id uuid,
  is_optional boolean DEFAULT false NOT NULL,
  notes text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN holidays.id IS 'Primary key';
COMMENT ON COLUMN holidays.type IS 'Enum: public, company, department, custom';
COMMENT ON COLUMN holidays.country IS 'Country calendar';
COMMENT ON COLUMN holidays.location_id IS 'Null = all locations';
COMMENT ON COLUMN holidays.notes IS 'e.g. subject to moon sighting';
COMMENT ON COLUMN holidays.created_at IS 'Row creation time';
COMMENT ON COLUMN holidays.updated_at IS 'Last update time';
COMMENT ON TABLE holidays IS 'Public / company holidays.';
CREATE TRIGGER trg_holidays_updated BEFORE UPDATE ON holidays FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================== Payroll (UAE)
-- One payroll per month.
CREATE TABLE payroll_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period char(7) NOT NULL UNIQUE,
  status payroll_status DEFAULT 'draft' NOT NULL,
  working_days smallint NOT NULL,
  employee_count integer DEFAULT 0 NOT NULL,
  total_gross numeric(14,2) DEFAULT 0 NOT NULL,
  total_deductions numeric(14,2) DEFAULT 0 NOT NULL,
  total_net numeric(14,2) DEFAULT 0 NOT NULL,
  created_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  locked_at timestamptz,
  paid_at timestamptz,
  wps_file_id uuid,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN payroll_runs.id IS 'Primary key';
COMMENT ON COLUMN payroll_runs.period IS 'YYYY-MM';
COMMENT ON COLUMN payroll_runs.status IS 'Enum: draft, approved, locked, paid';
COMMENT ON COLUMN payroll_runs.created_by IS 'User who created the record';
COMMENT ON COLUMN payroll_runs.wps_file_id IS 'Last exported SIF';
COMMENT ON COLUMN payroll_runs.created_at IS 'Row creation time';
COMMENT ON COLUMN payroll_runs.updated_at IS 'Last update time';
COMMENT ON TABLE payroll_runs IS 'One payroll per month.';
CREATE TRIGGER trg_payroll_runs_updated BEFORE UPDATE ON payroll_runs FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One line per employee per run (payslip).
CREATE TABLE payroll_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  basic numeric(12,2) NOT NULL,
  housing numeric(12,2) DEFAULT 0 NOT NULL,
  transport numeric(12,2) DEFAULT 0 NOT NULL,
  medical numeric(12,2) DEFAULT 0 NOT NULL,
  other_allowances numeric(12,2) DEFAULT 0 NOT NULL,
  overtime_hours numeric(6,2) DEFAULT 0 NOT NULL,
  overtime_amount numeric(12,2) DEFAULT 0 NOT NULL,
  bonus numeric(12,2) DEFAULT 0 NOT NULL,
  commission numeric(12,2) DEFAULT 0 NOT NULL,
  unpaid_leave_deduction numeric(12,2) DEFAULT 0 NOT NULL,
  loan_deduction numeric(12,2) DEFAULT 0 NOT NULL,
  other_deductions numeric(12,2) DEFAULT 0 NOT NULL,
  gross numeric(12,2) NOT NULL,
  total_deductions numeric(12,2) NOT NULL,
  net numeric(12,2) NOT NULL,
  working_days smallint,
  paid_days numeric(5,1),
  absent_days smallint DEFAULT 0 NOT NULL,
  unpaid_leave_days numeric(5,1) DEFAULT 0 NOT NULL,
  notes text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (payroll_run_id, employee_id)
);
COMMENT ON COLUMN payroll_items.id IS 'Primary key';
COMMENT ON COLUMN payroll_items.employee_id IS 'Employee';
COMMENT ON COLUMN payroll_items.notes IS 'Adjustment reason';
COMMENT ON COLUMN payroll_items.created_at IS 'Row creation time';
COMMENT ON COLUMN payroll_items.updated_at IS 'Last update time';
COMMENT ON TABLE payroll_items IS 'One line per employee per run (payslip).';
CREATE TRIGGER trg_payroll_items_updated BEFORE UPDATE ON payroll_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Loans and salary advances.
CREATE TABLE employee_loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  type loan_type NOT NULL,
  amount numeric(12,2) NOT NULL,
  installment numeric(12,2) NOT NULL,
  balance numeric(12,2) NOT NULL,
  start_date date NOT NULL,
  status text DEFAULT 'active' NOT NULL,
  reason text,
  approved_by uuid,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN employee_loans.id IS 'Primary key';
COMMENT ON COLUMN employee_loans.employee_id IS 'Employee';
COMMENT ON COLUMN employee_loans.type IS 'Enum: loan, advance';
COMMENT ON COLUMN employee_loans.status IS 'active | closed';
COMMENT ON COLUMN employee_loans.created_at IS 'Row creation time';
COMMENT ON COLUMN employee_loans.updated_at IS 'Last update time';
COMMENT ON TABLE employee_loans IS 'Loans and salary advances.';
CREATE TRIGGER trg_employee_loans_updated BEFORE UPDATE ON employee_loans FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Installments recovered through payroll.
CREATE TABLE loan_repayments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id uuid NOT NULL,
  payroll_item_id uuid,
  amount numeric(12,2) NOT NULL,
  paid_on date NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN loan_repayments.id IS 'Primary key';
COMMENT ON COLUMN loan_repayments.created_at IS 'Row creation time';
COMMENT ON COLUMN loan_repayments.updated_at IS 'Last update time';
COMMENT ON TABLE loan_repayments IS 'Installments recovered through payroll.';
CREATE TRIGGER trg_loan_repayments_updated BEFORE UPDATE ON loan_repayments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================== Final Settlement & Gratuity
-- Final settlement statement.
CREATE TABLE final_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  exit_id uuid,
  joining_date date NOT NULL,
  last_working_day date NOT NULL,
  separation_type text NOT NULL,
  service_years numeric(6,3) NOT NULL,
  gross_amount numeric(12,2) NOT NULL,
  total_deductions numeric(12,2) NOT NULL,
  net_amount numeric(12,2) NOT NULL,
  status settlement_status DEFAULT 'draft' NOT NULL,
  approved_by uuid,
  paid_at timestamptz,
  created_by uuid,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN final_settlements.id IS 'Primary key';
COMMENT ON COLUMN final_settlements.employee_id IS 'Employee';
COMMENT ON COLUMN final_settlements.separation_type IS 'Resignation, Termination, Contract end…';
COMMENT ON COLUMN final_settlements.status IS 'Enum: draft, approved, paid';
COMMENT ON COLUMN final_settlements.created_by IS 'User who created the record';
COMMENT ON COLUMN final_settlements.created_at IS 'Row creation time';
COMMENT ON COLUMN final_settlements.updated_at IS 'Last update time';
COMMENT ON TABLE final_settlements IS 'Final settlement statement.';
CREATE TRIGGER trg_final_settlements_updated BEFORE UPDATE ON final_settlements FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Line items of a settlement.
CREATE TABLE final_settlement_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id uuid NOT NULL,
  kind text NOT NULL,
  label text NOT NULL,
  amount numeric(12,2) NOT NULL,
  note text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN final_settlement_lines.id IS 'Primary key';
COMMENT ON COLUMN final_settlement_lines.kind IS 'addition | deduction';
COMMENT ON COLUMN final_settlement_lines.label IS 'e.g. End-of-service gratuity';
COMMENT ON COLUMN final_settlement_lines.note IS 'Calculation basis';
COMMENT ON COLUMN final_settlement_lines.created_at IS 'Row creation time';
COMMENT ON COLUMN final_settlement_lines.updated_at IS 'Last update time';
COMMENT ON TABLE final_settlement_lines IS 'Line items of a settlement.';
CREATE TRIGGER trg_final_settlement_lines_updated BEFORE UPDATE ON final_settlement_lines FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================== Performance, Goals & Promotions
-- Goals and OKRs.
CREATE TABLE goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  level goal_level NOT NULL,
  owner_id uuid,
  department_id uuid,
  parent_goal_id uuid,
  target text,
  progress smallint DEFAULT 0 NOT NULL,
  weight smallint DEFAULT 10 NOT NULL,
  due_date date,
  status goal_status DEFAULT 'in_progress' NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN goals.id IS 'Primary key';
COMMENT ON COLUMN goals.level IS 'Enum: company, department, employee';
COMMENT ON COLUMN goals.parent_goal_id IS 'Alignment to a higher goal';
COMMENT ON COLUMN goals.progress IS '0–100';
COMMENT ON COLUMN goals.weight IS '%';
COMMENT ON COLUMN goals.status IS 'Enum: not_started, in_progress, on_track, at_risk, completed';
COMMENT ON COLUMN goals.created_at IS 'Row creation time';
COMMENT ON COLUMN goals.updated_at IS 'Last update time';
COMMENT ON TABLE goals IS 'Goals and OKRs.';
CREATE TRIGGER trg_goals_updated BEFORE UPDATE ON goals FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Key results of a goal.
CREATE TABLE key_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id uuid NOT NULL,
  title text NOT NULL,
  target_value numeric,
  current_value numeric,
  progress smallint DEFAULT 0 NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN key_results.id IS 'Primary key';
COMMENT ON COLUMN key_results.created_at IS 'Row creation time';
COMMENT ON COLUMN key_results.updated_at IS 'Last update time';
COMMENT ON TABLE key_results IS 'Key results of a goal.';
CREATE TRIGGER trg_key_results_updated BEFORE UPDATE ON key_results FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Review periods.
CREATE TABLE review_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  type text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  status text DEFAULT 'open' NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN review_cycles.id IS 'Primary key';
COMMENT ON COLUMN review_cycles.name IS 'e.g. H2 2026';
COMMENT ON COLUMN review_cycles.type IS 'Annual, Half-year, Quarterly, Probation, 360°';
COMMENT ON COLUMN review_cycles.created_at IS 'Row creation time';
COMMENT ON COLUMN review_cycles.updated_at IS 'Last update time';
COMMENT ON TABLE review_cycles IS 'Review periods.';
CREATE TRIGGER trg_review_cycles_updated BEFORE UPDATE ON review_cycles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One review per employee per cycle.
CREATE TABLE performance_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  cycle_id uuid NOT NULL,
  reviewer_id uuid,
  due_date date,
  self_score numeric(3,1),
  manager_score numeric(3,1),
  final_rating numeric(3,1),
  status review_status DEFAULT 'not_started' NOT NULL,
  strengths text,
  improvements text,
  promotion_recommended boolean DEFAULT false NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (employee_id, cycle_id)
);
COMMENT ON COLUMN performance_reviews.id IS 'Primary key';
COMMENT ON COLUMN performance_reviews.employee_id IS 'Employee';
COMMENT ON COLUMN performance_reviews.self_score IS '1–5';
COMMENT ON COLUMN performance_reviews.manager_score IS '1–5';
COMMENT ON COLUMN performance_reviews.status IS 'Enum: not_started, self_review, manager_review, completed';
COMMENT ON COLUMN performance_reviews.created_at IS 'Row creation time';
COMMENT ON COLUMN performance_reviews.updated_at IS 'Last update time';
COMMENT ON TABLE performance_reviews IS 'One review per employee per cycle.';
CREATE TRIGGER trg_performance_reviews_updated BEFORE UPDATE ON performance_reviews FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Key performance indicators.
CREATE TABLE kpis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  name text NOT NULL,
  period text NOT NULL,
  weight smallint DEFAULT 50 NOT NULL,
  target numeric NOT NULL,
  actual numeric DEFAULT 0 NOT NULL,
  achievement numeric(6,1) DEFAULT 0 NOT NULL,
  self_rating smallint,
  manager_rating smallint,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN kpis.id IS 'Primary key';
COMMENT ON COLUMN kpis.employee_id IS 'Employee';
COMMENT ON COLUMN kpis.period IS 'e.g. Q4 2026';
COMMENT ON COLUMN kpis.achievement IS 'actual / target × 100';
COMMENT ON COLUMN kpis.created_at IS 'Row creation time';
COMMENT ON COLUMN kpis.updated_at IS 'Last update time';
COMMENT ON TABLE kpis IS 'Key performance indicators.';
CREATE TRIGGER trg_kpis_updated BEFORE UPDATE ON kpis FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Promotions and salary revisions.
CREATE TABLE salary_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  type text NOT NULL,
  current_designation_id uuid,
  new_designation_id uuid,
  current_salary numeric(12,2) NOT NULL,
  new_salary numeric(12,2) NOT NULL,
  increase_percent numeric(5,2) NOT NULL,
  effective_date date NOT NULL,
  reason text NOT NULL,
  status request_status DEFAULT 'pending' NOT NULL,
  created_by uuid,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN salary_revisions.id IS 'Primary key';
COMMENT ON COLUMN salary_revisions.employee_id IS 'Employee';
COMMENT ON COLUMN salary_revisions.type IS 'Promotion | Salary Revision';
COMMENT ON COLUMN salary_revisions.created_by IS 'User who created the record';
COMMENT ON COLUMN salary_revisions.created_at IS 'Row creation time';
COMMENT ON COLUMN salary_revisions.updated_at IS 'Last update time';
COMMENT ON TABLE salary_revisions IS 'Promotions and salary revisions.';
CREATE TRIGGER trg_salary_revisions_updated BEFORE UPDATE ON salary_revisions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================== Expense Management
-- Expense claims.
CREATE TABLE expense_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  employee_id uuid NOT NULL,
  category text NOT NULL,
  amount numeric(12,2) NOT NULL,
  currency char(3) DEFAULT 'AED' NOT NULL,
  expense_date date NOT NULL,
  description text NOT NULL,
  receipt_file_id uuid,
  project_id uuid,
  status expense_status DEFAULT 'pending' NOT NULL,
  reimbursed_at timestamptz,
  payroll_item_id uuid,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN expense_claims.id IS 'Primary key';
COMMENT ON COLUMN expense_claims.code IS 'EXP-1';
COMMENT ON COLUMN expense_claims.employee_id IS 'Employee';
COMMENT ON COLUMN expense_claims.status IS 'Enum: pending, manager_approved, approved, reimbursed, rejected';
COMMENT ON COLUMN expense_claims.payroll_item_id IS 'If reimbursed through payroll';
COMMENT ON COLUMN expense_claims.created_at IS 'Row creation time';
COMMENT ON COLUMN expense_claims.updated_at IS 'Last update time';
COMMENT ON TABLE expense_claims IS 'Expense claims.';
CREATE TRIGGER trg_expense_claims_updated BEFORE UPDATE ON expense_claims FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================== Documents & UAE Expiry Tracking
-- Every stored file (S3 object metadata).
CREATE TABLE files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_key text NOT NULL UNIQUE,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  checksum_sha256 text,
  uploaded_by uuid,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN files.id IS 'Primary key';
COMMENT ON COLUMN files.storage_key IS 'S3 object key';
COMMENT ON COLUMN files.file_name IS 'Original file name';
COMMENT ON COLUMN files.created_at IS 'Row creation time';
COMMENT ON COLUMN files.updated_at IS 'Last update time';
COMMENT ON TABLE files IS 'Every stored file (S3 object metadata).';
CREATE TRIGGER trg_files_updated BEFORE UPDATE ON files FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Employee and company documents.
CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid,
  category document_category NOT NULL,
  type text NOT NULL,
  number text,
  issue_date date,
  expiry_date date,
  status document_status DEFAULT 'pending_verification' NOT NULL,
  current_version smallint DEFAULT 1 NOT NULL,
  file_id uuid,
  verified_by uuid,
  verified_at timestamptz,
  uploaded_by uuid,
  notes text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN documents.id IS 'Primary key';
COMMENT ON COLUMN documents.employee_id IS 'Null = company-wide document';
COMMENT ON COLUMN documents.category IS 'Enum of the 10 categories';
COMMENT ON COLUMN documents.type IS 'Passport, Emirates ID, Residence Visa, Work Permit, Labour Contract…';
COMMENT ON COLUMN documents.number IS 'Document number (encrypted for IDs)';
COMMENT ON COLUMN documents.expiry_date IS 'Drives expiry tracking';
COMMENT ON COLUMN documents.status IS 'Enum: verified, pending_verification, rejected';
COMMENT ON COLUMN documents.file_id IS 'Current file';
COMMENT ON COLUMN documents.uploaded_by IS 'Who uploaded the current version';
COMMENT ON COLUMN documents.created_at IS 'Row creation time';
COMMENT ON COLUMN documents.updated_at IS 'Last update time';
COMMENT ON TABLE documents IS 'Employee and company documents.';
CREATE TRIGGER trg_documents_updated BEFORE UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Version history.
CREATE TABLE document_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL,
  version smallint NOT NULL,
  file_id uuid NOT NULL,
  uploaded_by uuid,
  note text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (document_id, version)
);
COMMENT ON COLUMN document_versions.id IS 'Primary key';
COMMENT ON COLUMN document_versions.created_at IS 'Row creation time';
COMMENT ON COLUMN document_versions.updated_at IS 'Last update time';
COMMENT ON TABLE document_versions IS 'Version history.';
CREATE TRIGGER trg_document_versions_updated BEFORE UPDATE ON document_versions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Reminders already sent (prevents duplicates).
CREATE TABLE document_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL,
  days_before smallint NOT NULL,
  sent_at timestamptz DEFAULT now() NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (document_id, days_before)
);
COMMENT ON COLUMN document_reminders.id IS 'Primary key';
COMMENT ON COLUMN document_reminders.days_before IS '90, 60, 30, 7';
COMMENT ON COLUMN document_reminders.created_at IS 'Row creation time';
COMMENT ON COLUMN document_reminders.updated_at IS 'Last update time';
COMMENT ON TABLE document_reminders IS 'Reminders already sent (prevents duplicates).';
CREATE TRIGGER trg_document_reminders_updated BEFORE UPDATE ON document_reminders FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================== Asset Management
-- Asset register.
CREATE TABLE assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  type text NOT NULL,
  serial_number text UNIQUE,
  purchase_date date,
  cost numeric(12,2),
  warranty_expiry date,
  status asset_status DEFAULT 'in_stock' NOT NULL,
  condition text,
  location_id uuid,
  current_assignee_id uuid,
  notes text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN assets.id IS 'Primary key';
COMMENT ON COLUMN assets.code IS 'AST-0001';
COMMENT ON COLUMN assets.name IS 'Model';
COMMENT ON COLUMN assets.status IS 'Enum: in_stock, assigned, maintenance, returned, retired';
COMMENT ON COLUMN assets.condition IS 'New, Good, Fair, Poor, Damaged';
COMMENT ON COLUMN assets.created_at IS 'Row creation time';
COMMENT ON COLUMN assets.updated_at IS 'Last update time';
COMMENT ON TABLE assets IS 'Asset register.';
CREATE TRIGGER trg_assets_updated BEFORE UPDATE ON assets FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Assignment history.
CREATE TABLE asset_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  assigned_on date NOT NULL,
  returned_on date,
  condition_out text,
  condition_in text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN asset_assignments.id IS 'Primary key';
COMMENT ON COLUMN asset_assignments.employee_id IS 'Employee';
COMMENT ON COLUMN asset_assignments.created_at IS 'Row creation time';
COMMENT ON COLUMN asset_assignments.updated_at IS 'Last update time';
COMMENT ON TABLE asset_assignments IS 'Assignment history.';
CREATE TRIGGER trg_asset_assignments_updated BEFORE UPDATE ON asset_assignments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Maintenance log.
CREATE TABLE asset_maintenance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL,
  date date NOT NULL,
  description text NOT NULL,
  cost numeric(12,2),
  vendor text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN asset_maintenance.id IS 'Primary key';
COMMENT ON COLUMN asset_maintenance.created_at IS 'Row creation time';
COMMENT ON COLUMN asset_maintenance.updated_at IS 'Last update time';
COMMENT ON TABLE asset_maintenance IS 'Maintenance log.';
CREATE TRIGGER trg_asset_maintenance_updated BEFORE UPDATE ON asset_maintenance FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================== Training & Development
-- Training programs.
CREATE TABLE training_programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  category text NOT NULL,
  trainer text,
  start_date date NOT NULL,
  end_date date,
  mode text NOT NULL,
  seats smallint DEFAULT 20 NOT NULL,
  budget numeric(12,2),
  status text DEFAULT 'upcoming' NOT NULL,
  awards_certificate boolean DEFAULT false NOT NULL,
  description text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN training_programs.id IS 'Primary key';
COMMENT ON COLUMN training_programs.status IS 'upcoming, in_progress, completed, cancelled';
COMMENT ON COLUMN training_programs.created_at IS 'Row creation time';
COMMENT ON COLUMN training_programs.updated_at IS 'Last update time';
COMMENT ON TABLE training_programs IS 'Training programs.';
CREATE TRIGGER trg_training_programs_updated BEFORE UPDATE ON training_programs FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Who is enrolled.
CREATE TABLE training_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  status text DEFAULT 'enrolled' NOT NULL,
  certificate_file_id uuid,
  score numeric(5,1),
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (program_id, employee_id)
);
COMMENT ON COLUMN training_enrollments.id IS 'Primary key';
COMMENT ON COLUMN training_enrollments.employee_id IS 'Employee';
COMMENT ON COLUMN training_enrollments.status IS 'enrolled, attended, completed, no_show';
COMMENT ON COLUMN training_enrollments.created_at IS 'Row creation time';
COMMENT ON COLUMN training_enrollments.updated_at IS 'Last update time';
COMMENT ON TABLE training_enrollments IS 'Who is enrolled.';
CREATE TRIGGER trg_training_enrollments_updated BEFORE UPDATE ON training_enrollments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================== HR Helpdesk
-- HR tickets.
CREATE TABLE tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  employee_id uuid NOT NULL,
  category text NOT NULL,
  subject text NOT NULL,
  description text NOT NULL,
  priority priority DEFAULT 'medium' NOT NULL,
  status ticket_status DEFAULT 'open' NOT NULL,
  assigned_to uuid,
  sla_hours smallint DEFAULT 48 NOT NULL,
  due_at timestamptz,
  resolution text,
  resolved_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN tickets.id IS 'Primary key';
COMMENT ON COLUMN tickets.code IS 'TKT-1001';
COMMENT ON COLUMN tickets.employee_id IS 'Raised by';
COMMENT ON COLUMN tickets.priority IS 'Enum: low, medium, high, urgent';
COMMENT ON COLUMN tickets.status IS 'Enum: open, in_progress, resolved, closed';
COMMENT ON COLUMN tickets.due_at IS 'created_at + sla_hours';
COMMENT ON COLUMN tickets.created_at IS 'Row creation time';
COMMENT ON COLUMN tickets.updated_at IS 'Last update time';
COMMENT ON TABLE tickets IS 'HR tickets.';
CREATE TRIGGER trg_tickets_updated BEFORE UPDATE ON tickets FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Thread messages.
CREATE TABLE ticket_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL,
  author_user_id uuid NOT NULL,
  body text NOT NULL,
  is_internal boolean DEFAULT false NOT NULL,
  attachment_file_id uuid,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN ticket_comments.id IS 'Primary key';
COMMENT ON COLUMN ticket_comments.is_internal IS 'HR-only note';
COMMENT ON COLUMN ticket_comments.created_at IS 'Row creation time';
COMMENT ON COLUMN ticket_comments.updated_at IS 'Last update time';
COMMENT ON TABLE ticket_comments IS 'Thread messages.';
CREATE TRIGGER trg_ticket_comments_updated BEFORE UPDATE ON ticket_comments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================== Employee Relations & Engagement
-- Employee-relations cases.
CREATE TABLE er_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  employee_id uuid NOT NULL,
  type text NOT NULL,
  priority priority DEFAULT 'medium' NOT NULL,
  description text NOT NULL,
  assigned_to uuid,
  status text DEFAULT 'open' NOT NULL,
  is_confidential boolean DEFAULT false NOT NULL,
  resolution text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN er_cases.id IS 'Primary key';
COMMENT ON COLUMN er_cases.code IS 'CASE-1';
COMMENT ON COLUMN er_cases.employee_id IS 'Employee';
COMMENT ON COLUMN er_cases.status IS 'open, investigating, resolved, closed';
COMMENT ON COLUMN er_cases.created_at IS 'Row creation time';
COMMENT ON COLUMN er_cases.updated_at IS 'Last update time';
COMMENT ON TABLE er_cases IS 'Employee-relations cases.';
CREATE TRIGGER trg_er_cases_updated BEFORE UPDATE ON er_cases FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Case notes and attachments.
CREATE TABLE er_case_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL,
  author_user_id uuid NOT NULL,
  body text NOT NULL,
  attachment_file_id uuid,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN er_case_notes.id IS 'Primary key';
COMMENT ON COLUMN er_case_notes.created_at IS 'Row creation time';
COMMENT ON COLUMN er_case_notes.updated_at IS 'Last update time';
COMMENT ON TABLE er_case_notes IS 'Case notes and attachments.';
CREATE TRIGGER trg_er_case_notes_updated BEFORE UPDATE ON er_case_notes FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Awards and kudos.
CREATE TABLE recognitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  award text NOT NULL,
  reason text NOT NULL,
  points integer DEFAULT 100 NOT NULL,
  given_by uuid,
  award_date date DEFAULT current_date NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN recognitions.id IS 'Primary key';
COMMENT ON COLUMN recognitions.employee_id IS 'Employee';
COMMENT ON COLUMN recognitions.created_at IS 'Row creation time';
COMMENT ON COLUMN recognitions.updated_at IS 'Last update time';
COMMENT ON TABLE recognitions IS 'Awards and kudos.';
CREATE TRIGGER trg_recognitions_updated BEFORE UPDATE ON recognitions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Engagement and pulse surveys.
CREATE TABLE surveys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  type text NOT NULL,
  is_anonymous boolean DEFAULT true NOT NULL,
  status text DEFAULT 'draft' NOT NULL,
  start_date date,
  end_date date,
  questions jsonb DEFAULT '[]' NOT NULL,
  engagement_score numeric(5,1),
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN surveys.id IS 'Primary key';
COMMENT ON COLUMN surveys.type IS 'Pulse, Engagement';
COMMENT ON COLUMN surveys.status IS 'draft, active, closed';
COMMENT ON COLUMN surveys.questions IS '[{id, text, type: scale|text|choice, options[]}]';
COMMENT ON COLUMN surveys.engagement_score IS 'Calculated when the survey closes';
COMMENT ON COLUMN surveys.created_at IS 'Row creation time';
COMMENT ON COLUMN surveys.updated_at IS 'Last update time';
COMMENT ON TABLE surveys IS 'Engagement and pulse surveys.';
CREATE TRIGGER trg_surveys_updated BEFORE UPDATE ON surveys FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Survey answers (employee_id null when anonymous).
CREATE TABLE survey_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id uuid NOT NULL,
  employee_id uuid,
  answers jsonb NOT NULL,
  submitted_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN survey_responses.id IS 'Primary key';
COMMENT ON COLUMN survey_responses.answers IS '{questionId: value}';
COMMENT ON TABLE survey_responses IS 'Survey answers (employee_id null when anonymous).';

-- =============================================================== Announcements & Notifications
-- Company announcements.
CREATE TABLE announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL,
  category text NOT NULL,
  priority text DEFAULT 'normal' NOT NULL,
  audience text DEFAULT 'all' NOT NULL,
  is_pinned boolean DEFAULT false NOT NULL,
  author_id uuid,
  publish_at timestamptz DEFAULT now() NOT NULL,
  expires_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN announcements.id IS 'Primary key';
COMMENT ON COLUMN announcements.audience IS 'all, location:<id>, managers';
COMMENT ON COLUMN announcements.created_at IS 'Row creation time';
COMMENT ON COLUMN announcements.updated_at IS 'Last update time';
COMMENT ON TABLE announcements IS 'Company announcements.';
CREATE TRIGGER trg_announcements_updated BEFORE UPDATE ON announcements FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- In-app notifications (user_id or role_group).
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  role_group text,
  title text NOT NULL,
  message text NOT NULL,
  link text,
  is_read boolean DEFAULT false NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN notifications.id IS 'Primary key';
COMMENT ON COLUMN notifications.user_id IS 'Direct recipient';
COMMENT ON COLUMN notifications.role_group IS 'all | hr | finance — broadcast';
COMMENT ON COLUMN notifications.link IS 'Deep link in the app';
COMMENT ON COLUMN notifications.is_read IS 'For direct notifications';
COMMENT ON COLUMN notifications.created_at IS 'Row creation time';
COMMENT ON COLUMN notifications.updated_at IS 'Last update time';
COMMENT ON TABLE notifications IS 'In-app notifications (user_id or role_group).';
CREATE TRIGGER trg_notifications_updated BEFORE UPDATE ON notifications FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Per-user read state for broadcast notifications.
CREATE TABLE notification_reads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL,
  user_id uuid NOT NULL,
  read_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (notification_id, user_id)
);
COMMENT ON COLUMN notification_reads.id IS 'Primary key';
COMMENT ON TABLE notification_reads IS 'Per-user read state for broadcast notifications.';

-- Queued outbound emails (processed by a BullMQ worker).
CREATE TABLE email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  to_email citext NOT NULL,
  template text NOT NULL,
  payload jsonb NOT NULL,
  status text DEFAULT 'queued' NOT NULL,
  attempts smallint DEFAULT 0 NOT NULL,
  provider_message_id text,
  sent_at timestamptz,
  error text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN email_outbox.id IS 'Primary key';
COMMENT ON COLUMN email_outbox.template IS 'e.g. leave-approved';
COMMENT ON COLUMN email_outbox.status IS 'queued, sent, failed';
COMMENT ON COLUMN email_outbox.created_at IS 'Row creation time';
COMMENT ON COLUMN email_outbox.updated_at IS 'Last update time';
COMMENT ON TABLE email_outbox IS 'Queued outbound emails (processed by a BullMQ worker).';
CREATE TRIGGER trg_email_outbox_updated BEFORE UPDATE ON email_outbox FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================== Offboarding & Exit
-- Resignations / separations.
CREATE TABLE exits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  resignation_date date NOT NULL,
  last_working_day date NOT NULL,
  reason text NOT NULL,
  comments text,
  stage exit_stage DEFAULT 'submitted' NOT NULL,
  exit_interview_rating smallint,
  exit_interview_feedback text,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN exits.id IS 'Primary key';
COMMENT ON COLUMN exits.employee_id IS 'Employee';
COMMENT ON COLUMN exits.stage IS 'Enum: submitted, hr_review, notice_period, completed, withdrawn';
COMMENT ON COLUMN exits.created_at IS 'Row creation time';
COMMENT ON COLUMN exits.updated_at IS 'Last update time';
COMMENT ON TABLE exits IS 'Resignations / separations.';
CREATE TRIGGER trg_exits_updated BEFORE UPDATE ON exits FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Clearance checklist.
CREATE TABLE exit_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exit_id uuid NOT NULL,
  title text NOT NULL,
  owner_role text,
  is_done boolean DEFAULT false NOT NULL,
  done_by uuid,
  done_at timestamptz,
  sort_order smallint DEFAULT 0 NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN exit_checklist_items.id IS 'Primary key';
COMMENT ON COLUMN exit_checklist_items.created_at IS 'Row creation time';
COMMENT ON COLUMN exit_checklist_items.updated_at IS 'Last update time';
COMMENT ON TABLE exit_checklist_items IS 'Clearance checklist.';
CREATE TRIGGER trg_exit_checklist_items_updated BEFORE UPDATE ON exit_checklist_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================== Reports & Analytics
-- User-saved report configurations and schedules (planned).
CREATE TABLE saved_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  report_key text NOT NULL,
  name text NOT NULL,
  filters jsonb DEFAULT '{}' NOT NULL,
  schedule_cron text,
  recipients text[] DEFAULT '{}' NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN saved_reports.id IS 'Primary key';
COMMENT ON COLUMN saved_reports.schedule_cron IS 'Optional emailed schedule';
COMMENT ON COLUMN saved_reports.created_at IS 'Row creation time';
COMMENT ON COLUMN saved_reports.updated_at IS 'Last update time';
COMMENT ON TABLE saved_reports IS 'User-saved report configurations and schedules (planned).';
CREATE TRIGGER trg_saved_reports_updated BEFORE UPDATE ON saved_reports FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================== Audit Logs & Settings
-- Append-only audit trail (no UPDATE/DELETE grants).
CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  user_name text NOT NULL,
  role user_role,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id text,
  changes jsonb,
  ip inet,
  user_agent text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN audit_logs.id IS 'Primary key';
COMMENT ON COLUMN audit_logs.user_name IS 'Snapshot of name';
COMMENT ON COLUMN audit_logs.action IS 'Login, Created, Updated, Salary Updated, Approve…';
COMMENT ON COLUMN audit_logs.entity IS 'Table / resource';
COMMENT ON COLUMN audit_logs.changes IS '[{field, old, new}] or details';
COMMENT ON COLUMN audit_logs.created_at IS 'Row creation time';
COMMENT ON COLUMN audit_logs.updated_at IS 'Last update time';
COMMENT ON TABLE audit_logs IS 'Append-only audit trail (no UPDATE/DELETE grants).';
CREATE TRIGGER trg_audit_logs_updated BEFORE UPDATE ON audit_logs FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Key/value configuration grouped by section.
CREATE TABLE settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section text NOT NULL,
  key text NOT NULL,
  value jsonb NOT NULL,
  updated_by uuid,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (section, key)
);
COMMENT ON COLUMN settings.id IS 'Primary key';
COMMENT ON COLUMN settings.section IS 'company, hr, attendance, leave, payroll, notifications, security, workflow';
COMMENT ON COLUMN settings.created_at IS 'Row creation time';
COMMENT ON COLUMN settings.updated_at IS 'Last update time';
COMMENT ON TABLE settings IS 'Key/value configuration grouped by section.';
CREATE TRIGGER trg_settings_updated BEFORE UPDATE ON settings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Generic approval history for every workflow (leave, expense, revision, correction, settlement, job, exit).
CREATE TABLE approval_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  step smallint NOT NULL,
  approver_user_id uuid NOT NULL,
  approver_role user_role,
  action text NOT NULL,
  comment text,
  acted_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN approval_steps.id IS 'Primary key';
COMMENT ON COLUMN approval_steps.entity_type IS 'e.g. leave_request';
COMMENT ON COLUMN approval_steps.step IS '1 = manager, 2 = HR/finance…';
COMMENT ON COLUMN approval_steps.action IS 'approved, rejected, cancelled, reimbursed';
COMMENT ON TABLE approval_steps IS 'Generic approval history for every workflow (leave, expense, revision, correction, settlement, job, exit).';

-- Connected third-party services.
CREATE TABLE integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL UNIQUE,
  is_enabled boolean DEFAULT false NOT NULL,
  config jsonb DEFAULT '{}' NOT NULL,
  last_sync_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN integrations.id IS 'Primary key';
COMMENT ON COLUMN integrations.config IS 'Non-secret config; secrets in Secrets Manager';
COMMENT ON COLUMN integrations.created_at IS 'Row creation time';
COMMENT ON COLUMN integrations.updated_at IS 'Last update time';
COMMENT ON TABLE integrations IS 'Connected third-party services.';
CREATE TRIGGER trg_integrations_updated BEFORE UPDATE ON integrations FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================== Foreign keys
ALTER TABLE users ADD CONSTRAINT fk_users_employee_id FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE SET NULL;
ALTER TABLE refresh_tokens ADD CONSTRAINT fk_refresh_tokens_user_id FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE role_permissions ADD CONSTRAINT fk_role_permissions_role_id FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE RESTRICT;
ALTER TABLE employees ADD CONSTRAINT fk_employees_department_id FOREIGN KEY (department_id) REFERENCES departments (id) ON DELETE RESTRICT;
ALTER TABLE employees ADD CONSTRAINT fk_employees_designation_id FOREIGN KEY (designation_id) REFERENCES designations (id) ON DELETE RESTRICT;
ALTER TABLE employees ADD CONSTRAINT fk_employees_team_id FOREIGN KEY (team_id) REFERENCES teams (id) ON DELETE SET NULL;
ALTER TABLE employees ADD CONSTRAINT fk_employees_manager_id FOREIGN KEY (manager_id) REFERENCES employees (id) ON DELETE SET NULL;
ALTER TABLE employees ADD CONSTRAINT fk_employees_location_id FOREIGN KEY (location_id) REFERENCES locations (id) ON DELETE SET NULL;
ALTER TABLE employees ADD CONSTRAINT fk_employees_avatar_file_id FOREIGN KEY (avatar_file_id) REFERENCES files (id) ON DELETE SET NULL;
ALTER TABLE employee_emergency_contacts ADD CONSTRAINT fk_employee_emergency_contacts_employee_id FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE RESTRICT;
ALTER TABLE employee_bank_accounts ADD CONSTRAINT fk_employee_bank_accounts_employee_id FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE RESTRICT;
ALTER TABLE employee_skills ADD CONSTRAINT fk_employee_skills_employee_id FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE RESTRICT;
ALTER TABLE salary_structures ADD CONSTRAINT fk_salary_structures_employee_id FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE RESTRICT;
ALTER TABLE salary_structures ADD CONSTRAINT fk_salary_structures_salary_revision_id FOREIGN KEY (salary_revision_id) REFERENCES salary_revisions (id) ON DELETE SET NULL;
ALTER TABLE salary_structures ADD CONSTRAINT fk_salary_structures_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE company ADD CONSTRAINT fk_company_logo_file_id FOREIGN KEY (logo_file_id) REFERENCES files (id) ON DELETE SET NULL;
ALTER TABLE departments ADD CONSTRAINT fk_departments_manager_id FOREIGN KEY (manager_id) REFERENCES employees (id) ON DELETE SET NULL;
ALTER TABLE departments ADD CONSTRAINT fk_departments_parent_id FOREIGN KEY (parent_id) REFERENCES departments (id) ON DELETE SET NULL;
ALTER TABLE departments ADD CONSTRAINT fk_departments_location_id FOREIGN KEY (location_id) REFERENCES locations (id) ON DELETE SET NULL;
ALTER TABLE teams ADD CONSTRAINT fk_teams_department_id FOREIGN KEY (department_id) REFERENCES departments (id) ON DELETE RESTRICT;
ALTER TABLE teams ADD CONSTRAINT fk_teams_lead_id FOREIGN KEY (lead_id) REFERENCES employees (id) ON DELETE SET NULL;
ALTER TABLE designations ADD CONSTRAINT fk_designations_department_id FOREIGN KEY (department_id) REFERENCES departments (id) ON DELETE SET NULL;
ALTER TABLE job_requisitions ADD CONSTRAINT fk_job_requisitions_department_id FOREIGN KEY (department_id) REFERENCES departments (id) ON DELETE RESTRICT;
ALTER TABLE job_requisitions ADD CONSTRAINT fk_job_requisitions_designation_id FOREIGN KEY (designation_id) REFERENCES designations (id) ON DELETE SET NULL;
ALTER TABLE job_requisitions ADD CONSTRAINT fk_job_requisitions_location_id FOREIGN KEY (location_id) REFERENCES locations (id) ON DELETE SET NULL;
ALTER TABLE job_requisitions ADD CONSTRAINT fk_job_requisitions_hiring_manager_id FOREIGN KEY (hiring_manager_id) REFERENCES employees (id) ON DELETE SET NULL;
ALTER TABLE job_requisitions ADD CONSTRAINT fk_job_requisitions_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE candidates ADD CONSTRAINT fk_candidates_job_id FOREIGN KEY (job_id) REFERENCES job_requisitions (id) ON DELETE RESTRICT;
ALTER TABLE candidates ADD CONSTRAINT fk_candidates_recruiter_id FOREIGN KEY (recruiter_id) REFERENCES employees (id) ON DELETE SET NULL;
ALTER TABLE candidates ADD CONSTRAINT fk_candidates_resume_file_id FOREIGN KEY (resume_file_id) REFERENCES files (id) ON DELETE SET NULL;
ALTER TABLE candidates ADD CONSTRAINT fk_candidates_employee_id FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE SET NULL;
ALTER TABLE candidate_stage_history ADD CONSTRAINT fk_candidate_stage_history_candidate_id FOREIGN KEY (candidate_id) REFERENCES candidates (id) ON DELETE RESTRICT;
ALTER TABLE candidate_stage_history ADD CONSTRAINT fk_candidate_stage_history_changed_by FOREIGN KEY (changed_by) REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE interviews ADD CONSTRAINT fk_interviews_candidate_id FOREIGN KEY (candidate_id) REFERENCES candidates (id) ON DELETE RESTRICT;
ALTER TABLE interviews ADD CONSTRAINT fk_interviews_job_id FOREIGN KEY (job_id) REFERENCES job_requisitions (id) ON DELETE RESTRICT;
ALTER TABLE interviews ADD CONSTRAINT fk_interviews_interviewer_id FOREIGN KEY (interviewer_id) REFERENCES employees (id) ON DELETE RESTRICT;
ALTER TABLE offers ADD CONSTRAINT fk_offers_candidate_id FOREIGN KEY (candidate_id) REFERENCES candidates (id) ON DELETE RESTRICT;
ALTER TABLE offers ADD CONSTRAINT fk_offers_job_id FOREIGN KEY (job_id) REFERENCES job_requisitions (id) ON DELETE RESTRICT;
ALTER TABLE offers ADD CONSTRAINT fk_offers_letter_file_id FOREIGN KEY (letter_file_id) REFERENCES files (id) ON DELETE SET NULL;
ALTER TABLE onboarding_processes ADD CONSTRAINT fk_onboarding_processes_employee_id FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE RESTRICT;
ALTER TABLE onboarding_processes ADD CONSTRAINT fk_onboarding_processes_buddy_id FOREIGN KEY (buddy_id) REFERENCES employees (id) ON DELETE SET NULL;
ALTER TABLE onboarding_tasks ADD CONSTRAINT fk_onboarding_tasks_process_id FOREIGN KEY (process_id) REFERENCES onboarding_processes (id) ON DELETE RESTRICT;
ALTER TABLE onboarding_tasks ADD CONSTRAINT fk_onboarding_tasks_template_id FOREIGN KEY (template_id) REFERENCES onboarding_task_templates (id) ON DELETE SET NULL;
ALTER TABLE onboarding_tasks ADD CONSTRAINT fk_onboarding_tasks_assignee_id FOREIGN KEY (assignee_id) REFERENCES employees (id) ON DELETE SET NULL;
ALTER TABLE onboarding_tasks ADD CONSTRAINT fk_onboarding_tasks_done_by FOREIGN KEY (done_by) REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE shift_assignments ADD CONSTRAINT fk_shift_assignments_employee_id FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE RESTRICT;
ALTER TABLE shift_assignments ADD CONSTRAINT fk_shift_assignments_shift_id FOREIGN KEY (shift_id) REFERENCES shifts (id) ON DELETE RESTRICT;
ALTER TABLE attendance_records ADD CONSTRAINT fk_attendance_records_employee_id FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE RESTRICT;
ALTER TABLE attendance_corrections ADD CONSTRAINT fk_attendance_corrections_employee_id FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE RESTRICT;
ALTER TABLE attendance_corrections ADD CONSTRAINT fk_attendance_corrections_reviewed_by FOREIGN KEY (reviewed_by) REFERENCES employees (id) ON DELETE SET NULL;
ALTER TABLE timesheet_entries ADD CONSTRAINT fk_timesheet_entries_employee_id FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE RESTRICT;
ALTER TABLE timesheet_entries ADD CONSTRAINT fk_timesheet_entries_project_id FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE RESTRICT;
ALTER TABLE leave_balances ADD CONSTRAINT fk_leave_balances_employee_id FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE RESTRICT;
ALTER TABLE leave_balances ADD CONSTRAINT fk_leave_balances_leave_type_id FOREIGN KEY (leave_type_id) REFERENCES leave_types (id) ON DELETE RESTRICT;
ALTER TABLE leave_requests ADD CONSTRAINT fk_leave_requests_employee_id FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE RESTRICT;
ALTER TABLE leave_requests ADD CONSTRAINT fk_leave_requests_leave_type_id FOREIGN KEY (leave_type_id) REFERENCES leave_types (id) ON DELETE RESTRICT;
ALTER TABLE leave_requests ADD CONSTRAINT fk_leave_requests_attachment_file_id FOREIGN KEY (attachment_file_id) REFERENCES files (id) ON DELETE SET NULL;
ALTER TABLE holidays ADD CONSTRAINT fk_holidays_location_id FOREIGN KEY (location_id) REFERENCES locations (id) ON DELETE SET NULL;
ALTER TABLE holidays ADD CONSTRAINT fk_holidays_department_id FOREIGN KEY (department_id) REFERENCES departments (id) ON DELETE SET NULL;
ALTER TABLE payroll_runs ADD CONSTRAINT fk_payroll_runs_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE payroll_runs ADD CONSTRAINT fk_payroll_runs_approved_by FOREIGN KEY (approved_by) REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE payroll_runs ADD CONSTRAINT fk_payroll_runs_wps_file_id FOREIGN KEY (wps_file_id) REFERENCES files (id) ON DELETE SET NULL;
ALTER TABLE payroll_items ADD CONSTRAINT fk_payroll_items_payroll_run_id FOREIGN KEY (payroll_run_id) REFERENCES payroll_runs (id) ON DELETE RESTRICT;
ALTER TABLE payroll_items ADD CONSTRAINT fk_payroll_items_employee_id FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE RESTRICT;
ALTER TABLE employee_loans ADD CONSTRAINT fk_employee_loans_employee_id FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE RESTRICT;
ALTER TABLE employee_loans ADD CONSTRAINT fk_employee_loans_approved_by FOREIGN KEY (approved_by) REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE loan_repayments ADD CONSTRAINT fk_loan_repayments_loan_id FOREIGN KEY (loan_id) REFERENCES employee_loans (id) ON DELETE RESTRICT;
ALTER TABLE loan_repayments ADD CONSTRAINT fk_loan_repayments_payroll_item_id FOREIGN KEY (payroll_item_id) REFERENCES payroll_items (id) ON DELETE SET NULL;
ALTER TABLE final_settlements ADD CONSTRAINT fk_final_settlements_employee_id FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE RESTRICT;
ALTER TABLE final_settlements ADD CONSTRAINT fk_final_settlements_exit_id FOREIGN KEY (exit_id) REFERENCES exits (id) ON DELETE SET NULL;
ALTER TABLE final_settlements ADD CONSTRAINT fk_final_settlements_approved_by FOREIGN KEY (approved_by) REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE final_settlements ADD CONSTRAINT fk_final_settlements_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE final_settlement_lines ADD CONSTRAINT fk_final_settlement_lines_settlement_id FOREIGN KEY (settlement_id) REFERENCES final_settlements (id) ON DELETE RESTRICT;
ALTER TABLE goals ADD CONSTRAINT fk_goals_owner_id FOREIGN KEY (owner_id) REFERENCES employees (id) ON DELETE SET NULL;
ALTER TABLE goals ADD CONSTRAINT fk_goals_department_id FOREIGN KEY (department_id) REFERENCES departments (id) ON DELETE SET NULL;
ALTER TABLE goals ADD CONSTRAINT fk_goals_parent_goal_id FOREIGN KEY (parent_goal_id) REFERENCES goals (id) ON DELETE SET NULL;
ALTER TABLE key_results ADD CONSTRAINT fk_key_results_goal_id FOREIGN KEY (goal_id) REFERENCES goals (id) ON DELETE RESTRICT;
ALTER TABLE performance_reviews ADD CONSTRAINT fk_performance_reviews_employee_id FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE RESTRICT;
ALTER TABLE performance_reviews ADD CONSTRAINT fk_performance_reviews_cycle_id FOREIGN KEY (cycle_id) REFERENCES review_cycles (id) ON DELETE RESTRICT;
ALTER TABLE performance_reviews ADD CONSTRAINT fk_performance_reviews_reviewer_id FOREIGN KEY (reviewer_id) REFERENCES employees (id) ON DELETE SET NULL;
ALTER TABLE kpis ADD CONSTRAINT fk_kpis_employee_id FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE RESTRICT;
ALTER TABLE salary_revisions ADD CONSTRAINT fk_salary_revisions_employee_id FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE RESTRICT;
ALTER TABLE salary_revisions ADD CONSTRAINT fk_salary_revisions_current_designation_id FOREIGN KEY (current_designation_id) REFERENCES designations (id) ON DELETE SET NULL;
ALTER TABLE salary_revisions ADD CONSTRAINT fk_salary_revisions_new_designation_id FOREIGN KEY (new_designation_id) REFERENCES designations (id) ON DELETE SET NULL;
ALTER TABLE salary_revisions ADD CONSTRAINT fk_salary_revisions_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE expense_claims ADD CONSTRAINT fk_expense_claims_employee_id FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE RESTRICT;
ALTER TABLE expense_claims ADD CONSTRAINT fk_expense_claims_receipt_file_id FOREIGN KEY (receipt_file_id) REFERENCES files (id) ON DELETE SET NULL;
ALTER TABLE expense_claims ADD CONSTRAINT fk_expense_claims_project_id FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE SET NULL;
ALTER TABLE expense_claims ADD CONSTRAINT fk_expense_claims_payroll_item_id FOREIGN KEY (payroll_item_id) REFERENCES payroll_items (id) ON DELETE SET NULL;
ALTER TABLE files ADD CONSTRAINT fk_files_uploaded_by FOREIGN KEY (uploaded_by) REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE documents ADD CONSTRAINT fk_documents_employee_id FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE SET NULL;
ALTER TABLE documents ADD CONSTRAINT fk_documents_file_id FOREIGN KEY (file_id) REFERENCES files (id) ON DELETE SET NULL;
ALTER TABLE documents ADD CONSTRAINT fk_documents_verified_by FOREIGN KEY (verified_by) REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE documents ADD CONSTRAINT fk_documents_uploaded_by FOREIGN KEY (uploaded_by) REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE document_versions ADD CONSTRAINT fk_document_versions_document_id FOREIGN KEY (document_id) REFERENCES documents (id) ON DELETE RESTRICT;
ALTER TABLE document_versions ADD CONSTRAINT fk_document_versions_file_id FOREIGN KEY (file_id) REFERENCES files (id) ON DELETE RESTRICT;
ALTER TABLE document_versions ADD CONSTRAINT fk_document_versions_uploaded_by FOREIGN KEY (uploaded_by) REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE document_reminders ADD CONSTRAINT fk_document_reminders_document_id FOREIGN KEY (document_id) REFERENCES documents (id) ON DELETE RESTRICT;
ALTER TABLE assets ADD CONSTRAINT fk_assets_location_id FOREIGN KEY (location_id) REFERENCES locations (id) ON DELETE SET NULL;
ALTER TABLE assets ADD CONSTRAINT fk_assets_current_assignee_id FOREIGN KEY (current_assignee_id) REFERENCES employees (id) ON DELETE SET NULL;
ALTER TABLE asset_assignments ADD CONSTRAINT fk_asset_assignments_asset_id FOREIGN KEY (asset_id) REFERENCES assets (id) ON DELETE RESTRICT;
ALTER TABLE asset_assignments ADD CONSTRAINT fk_asset_assignments_employee_id FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE RESTRICT;
ALTER TABLE asset_maintenance ADD CONSTRAINT fk_asset_maintenance_asset_id FOREIGN KEY (asset_id) REFERENCES assets (id) ON DELETE RESTRICT;
ALTER TABLE training_enrollments ADD CONSTRAINT fk_training_enrollments_program_id FOREIGN KEY (program_id) REFERENCES training_programs (id) ON DELETE RESTRICT;
ALTER TABLE training_enrollments ADD CONSTRAINT fk_training_enrollments_employee_id FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE RESTRICT;
ALTER TABLE training_enrollments ADD CONSTRAINT fk_training_enrollments_certificate_file_id FOREIGN KEY (certificate_file_id) REFERENCES files (id) ON DELETE SET NULL;
ALTER TABLE tickets ADD CONSTRAINT fk_tickets_employee_id FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE RESTRICT;
ALTER TABLE tickets ADD CONSTRAINT fk_tickets_assigned_to FOREIGN KEY (assigned_to) REFERENCES employees (id) ON DELETE SET NULL;
ALTER TABLE ticket_comments ADD CONSTRAINT fk_ticket_comments_ticket_id FOREIGN KEY (ticket_id) REFERENCES tickets (id) ON DELETE RESTRICT;
ALTER TABLE ticket_comments ADD CONSTRAINT fk_ticket_comments_author_user_id FOREIGN KEY (author_user_id) REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE ticket_comments ADD CONSTRAINT fk_ticket_comments_attachment_file_id FOREIGN KEY (attachment_file_id) REFERENCES files (id) ON DELETE SET NULL;
ALTER TABLE er_cases ADD CONSTRAINT fk_er_cases_employee_id FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE RESTRICT;
ALTER TABLE er_cases ADD CONSTRAINT fk_er_cases_assigned_to FOREIGN KEY (assigned_to) REFERENCES employees (id) ON DELETE SET NULL;
ALTER TABLE er_case_notes ADD CONSTRAINT fk_er_case_notes_case_id FOREIGN KEY (case_id) REFERENCES er_cases (id) ON DELETE RESTRICT;
ALTER TABLE er_case_notes ADD CONSTRAINT fk_er_case_notes_author_user_id FOREIGN KEY (author_user_id) REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE er_case_notes ADD CONSTRAINT fk_er_case_notes_attachment_file_id FOREIGN KEY (attachment_file_id) REFERENCES files (id) ON DELETE SET NULL;
ALTER TABLE recognitions ADD CONSTRAINT fk_recognitions_employee_id FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE RESTRICT;
ALTER TABLE recognitions ADD CONSTRAINT fk_recognitions_given_by FOREIGN KEY (given_by) REFERENCES employees (id) ON DELETE SET NULL;
ALTER TABLE survey_responses ADD CONSTRAINT fk_survey_responses_survey_id FOREIGN KEY (survey_id) REFERENCES surveys (id) ON DELETE RESTRICT;
ALTER TABLE survey_responses ADD CONSTRAINT fk_survey_responses_employee_id FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE SET NULL;
ALTER TABLE announcements ADD CONSTRAINT fk_announcements_author_id FOREIGN KEY (author_id) REFERENCES employees (id) ON DELETE SET NULL;
ALTER TABLE notifications ADD CONSTRAINT fk_notifications_user_id FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE notification_reads ADD CONSTRAINT fk_notification_reads_notification_id FOREIGN KEY (notification_id) REFERENCES notifications (id) ON DELETE RESTRICT;
ALTER TABLE notification_reads ADD CONSTRAINT fk_notification_reads_user_id FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE exits ADD CONSTRAINT fk_exits_employee_id FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE RESTRICT;
ALTER TABLE exit_checklist_items ADD CONSTRAINT fk_exit_checklist_items_exit_id FOREIGN KEY (exit_id) REFERENCES exits (id) ON DELETE RESTRICT;
ALTER TABLE exit_checklist_items ADD CONSTRAINT fk_exit_checklist_items_done_by FOREIGN KEY (done_by) REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE saved_reports ADD CONSTRAINT fk_saved_reports_owner_user_id FOREIGN KEY (owner_user_id) REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE audit_logs ADD CONSTRAINT fk_audit_logs_user_id FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE settings ADD CONSTRAINT fk_settings_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE approval_steps ADD CONSTRAINT fk_approval_steps_approver_user_id FOREIGN KEY (approver_user_id) REFERENCES users (id) ON DELETE RESTRICT;

-- =============================================================== Indexes
CREATE INDEX IF NOT EXISTS ix_refresh_tokens_user_id ON refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS ix_role_permissions_role_id ON role_permissions (role_id);
CREATE INDEX IF NOT EXISTS ix_employees_department_id ON employees (department_id);
CREATE INDEX IF NOT EXISTS ix_employees_designation_id ON employees (designation_id);
CREATE INDEX IF NOT EXISTS ix_employees_team_id ON employees (team_id);
CREATE INDEX IF NOT EXISTS ix_employees_manager_id ON employees (manager_id);
CREATE INDEX IF NOT EXISTS ix_employees_location_id ON employees (location_id);
CREATE INDEX IF NOT EXISTS ix_employees_avatar_file_id ON employees (avatar_file_id);
CREATE INDEX IF NOT EXISTS ix_employee_emergency_contacts_employee_id ON employee_emergency_contacts (employee_id);
CREATE INDEX IF NOT EXISTS ix_employee_bank_accounts_employee_id ON employee_bank_accounts (employee_id);
CREATE INDEX IF NOT EXISTS ix_employee_skills_employee_id ON employee_skills (employee_id);
CREATE INDEX IF NOT EXISTS ix_salary_structures_employee_id ON salary_structures (employee_id);
CREATE INDEX IF NOT EXISTS ix_salary_structures_salary_revision_id ON salary_structures (salary_revision_id);
CREATE INDEX IF NOT EXISTS ix_salary_structures_created_by ON salary_structures (created_by);
CREATE INDEX IF NOT EXISTS ix_company_logo_file_id ON company (logo_file_id);
CREATE INDEX IF NOT EXISTS ix_departments_manager_id ON departments (manager_id);
CREATE INDEX IF NOT EXISTS ix_departments_parent_id ON departments (parent_id);
CREATE INDEX IF NOT EXISTS ix_departments_location_id ON departments (location_id);
CREATE INDEX IF NOT EXISTS ix_teams_department_id ON teams (department_id);
CREATE INDEX IF NOT EXISTS ix_teams_lead_id ON teams (lead_id);
CREATE INDEX IF NOT EXISTS ix_designations_department_id ON designations (department_id);
CREATE INDEX IF NOT EXISTS ix_job_requisitions_department_id ON job_requisitions (department_id);
CREATE INDEX IF NOT EXISTS ix_job_requisitions_designation_id ON job_requisitions (designation_id);
CREATE INDEX IF NOT EXISTS ix_job_requisitions_location_id ON job_requisitions (location_id);
CREATE INDEX IF NOT EXISTS ix_job_requisitions_hiring_manager_id ON job_requisitions (hiring_manager_id);
CREATE INDEX IF NOT EXISTS ix_job_requisitions_created_by ON job_requisitions (created_by);
CREATE INDEX IF NOT EXISTS ix_candidates_job_id ON candidates (job_id);
CREATE INDEX IF NOT EXISTS ix_candidates_recruiter_id ON candidates (recruiter_id);
CREATE INDEX IF NOT EXISTS ix_candidates_resume_file_id ON candidates (resume_file_id);
CREATE INDEX IF NOT EXISTS ix_candidates_employee_id ON candidates (employee_id);
CREATE INDEX IF NOT EXISTS ix_candidate_stage_history_candidate_id ON candidate_stage_history (candidate_id);
CREATE INDEX IF NOT EXISTS ix_candidate_stage_history_changed_by ON candidate_stage_history (changed_by);
CREATE INDEX IF NOT EXISTS ix_interviews_candidate_id ON interviews (candidate_id);
CREATE INDEX IF NOT EXISTS ix_interviews_job_id ON interviews (job_id);
CREATE INDEX IF NOT EXISTS ix_interviews_interviewer_id ON interviews (interviewer_id);
CREATE INDEX IF NOT EXISTS ix_offers_candidate_id ON offers (candidate_id);
CREATE INDEX IF NOT EXISTS ix_offers_job_id ON offers (job_id);
CREATE INDEX IF NOT EXISTS ix_offers_letter_file_id ON offers (letter_file_id);
CREATE INDEX IF NOT EXISTS ix_onboarding_processes_employee_id ON onboarding_processes (employee_id);
CREATE INDEX IF NOT EXISTS ix_onboarding_processes_buddy_id ON onboarding_processes (buddy_id);
CREATE INDEX IF NOT EXISTS ix_onboarding_tasks_process_id ON onboarding_tasks (process_id);
CREATE INDEX IF NOT EXISTS ix_onboarding_tasks_template_id ON onboarding_tasks (template_id);
CREATE INDEX IF NOT EXISTS ix_onboarding_tasks_assignee_id ON onboarding_tasks (assignee_id);
CREATE INDEX IF NOT EXISTS ix_onboarding_tasks_done_by ON onboarding_tasks (done_by);
CREATE INDEX IF NOT EXISTS ix_shift_assignments_employee_id ON shift_assignments (employee_id);
CREATE INDEX IF NOT EXISTS ix_shift_assignments_shift_id ON shift_assignments (shift_id);
CREATE INDEX IF NOT EXISTS ix_attendance_records_employee_id ON attendance_records (employee_id);
CREATE INDEX IF NOT EXISTS ix_attendance_corrections_employee_id ON attendance_corrections (employee_id);
CREATE INDEX IF NOT EXISTS ix_attendance_corrections_reviewed_by ON attendance_corrections (reviewed_by);
CREATE INDEX IF NOT EXISTS ix_timesheet_entries_employee_id ON timesheet_entries (employee_id);
CREATE INDEX IF NOT EXISTS ix_timesheet_entries_project_id ON timesheet_entries (project_id);
CREATE INDEX IF NOT EXISTS ix_leave_balances_employee_id ON leave_balances (employee_id);
CREATE INDEX IF NOT EXISTS ix_leave_balances_leave_type_id ON leave_balances (leave_type_id);
CREATE INDEX IF NOT EXISTS ix_leave_requests_employee_id ON leave_requests (employee_id);
CREATE INDEX IF NOT EXISTS ix_leave_requests_leave_type_id ON leave_requests (leave_type_id);
CREATE INDEX IF NOT EXISTS ix_leave_requests_attachment_file_id ON leave_requests (attachment_file_id);
CREATE INDEX IF NOT EXISTS ix_holidays_location_id ON holidays (location_id);
CREATE INDEX IF NOT EXISTS ix_holidays_department_id ON holidays (department_id);
CREATE INDEX IF NOT EXISTS ix_payroll_runs_created_by ON payroll_runs (created_by);
CREATE INDEX IF NOT EXISTS ix_payroll_runs_approved_by ON payroll_runs (approved_by);
CREATE INDEX IF NOT EXISTS ix_payroll_runs_wps_file_id ON payroll_runs (wps_file_id);
CREATE INDEX IF NOT EXISTS ix_payroll_items_payroll_run_id ON payroll_items (payroll_run_id);
CREATE INDEX IF NOT EXISTS ix_payroll_items_employee_id ON payroll_items (employee_id);
CREATE INDEX IF NOT EXISTS ix_employee_loans_employee_id ON employee_loans (employee_id);
CREATE INDEX IF NOT EXISTS ix_employee_loans_approved_by ON employee_loans (approved_by);
CREATE INDEX IF NOT EXISTS ix_loan_repayments_loan_id ON loan_repayments (loan_id);
CREATE INDEX IF NOT EXISTS ix_loan_repayments_payroll_item_id ON loan_repayments (payroll_item_id);
CREATE INDEX IF NOT EXISTS ix_final_settlements_employee_id ON final_settlements (employee_id);
CREATE INDEX IF NOT EXISTS ix_final_settlements_exit_id ON final_settlements (exit_id);
CREATE INDEX IF NOT EXISTS ix_final_settlements_approved_by ON final_settlements (approved_by);
CREATE INDEX IF NOT EXISTS ix_final_settlements_created_by ON final_settlements (created_by);
CREATE INDEX IF NOT EXISTS ix_final_settlement_lines_settlement_id ON final_settlement_lines (settlement_id);
CREATE INDEX IF NOT EXISTS ix_goals_owner_id ON goals (owner_id);
CREATE INDEX IF NOT EXISTS ix_goals_department_id ON goals (department_id);
CREATE INDEX IF NOT EXISTS ix_goals_parent_goal_id ON goals (parent_goal_id);
CREATE INDEX IF NOT EXISTS ix_key_results_goal_id ON key_results (goal_id);
CREATE INDEX IF NOT EXISTS ix_performance_reviews_employee_id ON performance_reviews (employee_id);
CREATE INDEX IF NOT EXISTS ix_performance_reviews_cycle_id ON performance_reviews (cycle_id);
CREATE INDEX IF NOT EXISTS ix_performance_reviews_reviewer_id ON performance_reviews (reviewer_id);
CREATE INDEX IF NOT EXISTS ix_kpis_employee_id ON kpis (employee_id);
CREATE INDEX IF NOT EXISTS ix_salary_revisions_employee_id ON salary_revisions (employee_id);
CREATE INDEX IF NOT EXISTS ix_salary_revisions_current_designation_id ON salary_revisions (current_designation_id);
CREATE INDEX IF NOT EXISTS ix_salary_revisions_new_designation_id ON salary_revisions (new_designation_id);
CREATE INDEX IF NOT EXISTS ix_salary_revisions_created_by ON salary_revisions (created_by);
CREATE INDEX IF NOT EXISTS ix_expense_claims_employee_id ON expense_claims (employee_id);
CREATE INDEX IF NOT EXISTS ix_expense_claims_receipt_file_id ON expense_claims (receipt_file_id);
CREATE INDEX IF NOT EXISTS ix_expense_claims_project_id ON expense_claims (project_id);
CREATE INDEX IF NOT EXISTS ix_expense_claims_payroll_item_id ON expense_claims (payroll_item_id);
CREATE INDEX IF NOT EXISTS ix_files_uploaded_by ON files (uploaded_by);
CREATE INDEX IF NOT EXISTS ix_documents_employee_id ON documents (employee_id);
CREATE INDEX IF NOT EXISTS ix_documents_expiry_date ON documents (expiry_date);
CREATE INDEX IF NOT EXISTS ix_documents_file_id ON documents (file_id);
CREATE INDEX IF NOT EXISTS ix_documents_verified_by ON documents (verified_by);
CREATE INDEX IF NOT EXISTS ix_documents_uploaded_by ON documents (uploaded_by);
CREATE INDEX IF NOT EXISTS ix_document_versions_document_id ON document_versions (document_id);
CREATE INDEX IF NOT EXISTS ix_document_versions_file_id ON document_versions (file_id);
CREATE INDEX IF NOT EXISTS ix_document_versions_uploaded_by ON document_versions (uploaded_by);
CREATE INDEX IF NOT EXISTS ix_document_reminders_document_id ON document_reminders (document_id);
CREATE INDEX IF NOT EXISTS ix_assets_location_id ON assets (location_id);
CREATE INDEX IF NOT EXISTS ix_assets_current_assignee_id ON assets (current_assignee_id);
CREATE INDEX IF NOT EXISTS ix_asset_assignments_asset_id ON asset_assignments (asset_id);
CREATE INDEX IF NOT EXISTS ix_asset_assignments_employee_id ON asset_assignments (employee_id);
CREATE INDEX IF NOT EXISTS ix_asset_maintenance_asset_id ON asset_maintenance (asset_id);
CREATE INDEX IF NOT EXISTS ix_training_enrollments_program_id ON training_enrollments (program_id);
CREATE INDEX IF NOT EXISTS ix_training_enrollments_employee_id ON training_enrollments (employee_id);
CREATE INDEX IF NOT EXISTS ix_training_enrollments_certificate_file_id ON training_enrollments (certificate_file_id);
CREATE INDEX IF NOT EXISTS ix_tickets_employee_id ON tickets (employee_id);
CREATE INDEX IF NOT EXISTS ix_tickets_assigned_to ON tickets (assigned_to);
CREATE INDEX IF NOT EXISTS ix_ticket_comments_ticket_id ON ticket_comments (ticket_id);
CREATE INDEX IF NOT EXISTS ix_ticket_comments_author_user_id ON ticket_comments (author_user_id);
CREATE INDEX IF NOT EXISTS ix_ticket_comments_attachment_file_id ON ticket_comments (attachment_file_id);
CREATE INDEX IF NOT EXISTS ix_er_cases_employee_id ON er_cases (employee_id);
CREATE INDEX IF NOT EXISTS ix_er_cases_assigned_to ON er_cases (assigned_to);
CREATE INDEX IF NOT EXISTS ix_er_case_notes_case_id ON er_case_notes (case_id);
CREATE INDEX IF NOT EXISTS ix_er_case_notes_author_user_id ON er_case_notes (author_user_id);
CREATE INDEX IF NOT EXISTS ix_er_case_notes_attachment_file_id ON er_case_notes (attachment_file_id);
CREATE INDEX IF NOT EXISTS ix_recognitions_employee_id ON recognitions (employee_id);
CREATE INDEX IF NOT EXISTS ix_recognitions_given_by ON recognitions (given_by);
CREATE INDEX IF NOT EXISTS ix_survey_responses_survey_id ON survey_responses (survey_id);
CREATE INDEX IF NOT EXISTS ix_survey_responses_employee_id ON survey_responses (employee_id);
CREATE INDEX IF NOT EXISTS ix_announcements_author_id ON announcements (author_id);
CREATE INDEX IF NOT EXISTS ix_notifications_user_id ON notifications (user_id);
CREATE INDEX IF NOT EXISTS ix_notification_reads_notification_id ON notification_reads (notification_id);
CREATE INDEX IF NOT EXISTS ix_notification_reads_user_id ON notification_reads (user_id);
CREATE INDEX IF NOT EXISTS ix_exits_employee_id ON exits (employee_id);
CREATE INDEX IF NOT EXISTS ix_exit_checklist_items_exit_id ON exit_checklist_items (exit_id);
CREATE INDEX IF NOT EXISTS ix_exit_checklist_items_done_by ON exit_checklist_items (done_by);
CREATE INDEX IF NOT EXISTS ix_saved_reports_owner_user_id ON saved_reports (owner_user_id);
CREATE INDEX IF NOT EXISTS ix_audit_logs_user_id ON audit_logs (user_id);
CREATE INDEX IF NOT EXISTS ix_audit_logs_action ON audit_logs (action);
CREATE INDEX IF NOT EXISTS ix_audit_logs_entity_id ON audit_logs (entity_id);
CREATE INDEX IF NOT EXISTS ix_settings_updated_by ON settings (updated_by);
CREATE INDEX IF NOT EXISTS ix_approval_steps_approver_user_id ON approval_steps (approver_user_id);
CREATE INDEX IF NOT EXISTS ix_approval_steps_entity_type_entity_id ON approval_steps (entity_type, entity_id);

-- Useful partial indexes
CREATE UNIQUE INDEX ux_salary_structures_current ON salary_structures (employee_id) WHERE effective_to IS NULL;
CREATE INDEX ix_documents_expiring ON documents (expiry_date) WHERE expiry_date IS NOT NULL;
CREATE INDEX ix_leave_requests_pending ON leave_requests (status) WHERE status IN ('pending','manager_approved');

-- Audit log is append-only: grant the application role INSERT/SELECT only
-- REVOKE UPDATE, DELETE ON audit_logs FROM medx_app;