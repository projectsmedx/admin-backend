-- Login usernames, account types, and internal vs outsourced employees

-- users: sign in with username (the employee code for employee accounts) or email
ALTER TABLE users ADD COLUMN IF NOT EXISTS username citext;
ALTER TABLE users ADD COLUMN IF NOT EXISTS user_type text DEFAULT 'employee' NOT NULL;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_user_type_check;
ALTER TABLE users ADD CONSTRAINT users_user_type_check CHECK (user_type IN ('employee', 'other'));
UPDATE users u SET username = e.code FROM employees e WHERE u.employee_id = e.id AND u.username IS NULL;
UPDATE users SET username = split_part(email::text, '@', 1) WHERE username IS NULL;
UPDATE users SET user_type = CASE WHEN employee_id IS NULL THEN 'other' ELSE 'employee' END;
-- Fills username when an insert leaves it out (e.g. code deployed before this migration)
CREATE OR REPLACE FUNCTION users_default_username() RETURNS trigger AS $$
BEGIN
  IF NEW.username IS NULL THEN
    NEW.username := COALESCE((SELECT code FROM employees WHERE id = NEW.employee_id), split_part(NEW.email::text, '@', 1));
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_users_default_username ON users;
CREATE TRIGGER trg_users_default_username BEFORE INSERT ON users FOR EACH ROW EXECUTE FUNCTION users_default_username();
ALTER TABLE users ALTER COLUMN username SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_users_username ON users (username);
COMMENT ON COLUMN users.username IS 'Login username; employee accounts use the employee code';
COMMENT ON COLUMN users.user_type IS 'employee (linked to an employee profile) or other (auditor, consultant, service account)';

-- employees: internal team member or outsourced
ALTER TABLE employees ADD COLUMN IF NOT EXISTS engagement_type text DEFAULT 'internal' NOT NULL;
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_engagement_type_check;
ALTER TABLE employees ADD CONSTRAINT employees_engagement_type_check CHECK (engagement_type IN ('internal', 'outsource'));
COMMENT ON COLUMN employees.engagement_type IS 'internal team member or outsource';

-- Only Super Admin can create employees (and therefore their logins)
UPDATE role_permissions p SET actions = array_remove(p.actions, 'create')
  FROM roles r WHERE r.id = p.role_id AND r.key <> 'super_admin' AND p.resource IN ('employees', 'users');
