-- Employee role / position level (Staff, Supervisor, Manager, Director …), separate from job title and login role
ALTER TABLE employees ADD COLUMN IF NOT EXISTS job_role text;
COMMENT ON COLUMN employees.job_role IS 'Position level: Staff, Team Lead, Supervisor, Manager, Senior Manager, Head of Department, Director';
CREATE INDEX IF NOT EXISTS ix_employees_job_role ON employees (job_role);
