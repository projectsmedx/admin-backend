-- Access roles follow the company's job roles: Admin, Manager, Pharmacist, Developer, Marketing, Customer Support.
-- Admin keeps the key super_admin. HR Admin, HR Manager and Finance fold into Admin; Employee becomes Developer.
-- Role columns become text so roles can be added without enum changes.
ALTER TABLE users ALTER COLUMN role DROP DEFAULT;
ALTER TABLE users ALTER COLUMN role TYPE text USING role::text;
ALTER TABLE approval_steps ALTER COLUMN approver_role TYPE text USING approver_role::text;
ALTER TABLE audit_logs ALTER COLUMN role TYPE text USING role::text;

UPDATE users SET role = CASE role WHEN 'hr_admin' THEN 'super_admin' WHEN 'hr_manager' THEN 'super_admin' WHEN 'finance' THEN 'super_admin' WHEN 'employee' THEN 'developer' ELSE role END;
ALTER TABLE users ALTER COLUMN role SET DEFAULT 'developer';
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('super_admin', 'manager', 'pharmacist', 'developer', 'marketing', 'customer_support'));
COMMENT ON COLUMN users.role IS 'super_admin (shown as Admin), manager, pharmacist, developer, marketing, customer_support';

-- Old role rows go; the API inserts default permissions for the new roles on start
DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE key IN ('hr_admin', 'hr_manager', 'finance', 'employee'));
DELETE FROM roles WHERE key IN ('hr_admin', 'hr_manager', 'finance', 'employee');
UPDATE roles SET name = 'Admin', description = 'Full access, including employees, logins and permissions' WHERE key = 'super_admin';
