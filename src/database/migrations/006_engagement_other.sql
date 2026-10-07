-- Employee type: internal team member, outsourced, or other (e.g. consultant, intern from a partner)
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_engagement_type_check;
ALTER TABLE employees ADD CONSTRAINT employees_engagement_type_check CHECK (engagement_type IN ('internal', 'outsource', 'other'));
COMMENT ON COLUMN employees.engagement_type IS 'internal, outsource or other';
