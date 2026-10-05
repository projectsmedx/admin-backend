-- Branches: extend locations with branch details, contact info, map link and per-day opening hours
ALTER TABLE locations
  ADD COLUMN IF NOT EXISTS branch_no integer,
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'pharmacy',
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS email citext,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS map_url text,
  ADD COLUMN IF NOT EXISTS ref_no_1 text,
  ADD COLUMN IF NOT EXISTS ref_no_2 text,
  ADD COLUMN IF NOT EXISTS opening_hours jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS manager_id uuid REFERENCES employees (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS notes text;

ALTER TABLE locations ALTER COLUMN city DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_locations_branch_no ON locations (branch_no) WHERE branch_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_employees_location_id ON employees (location_id);

COMMENT ON COLUMN locations.branch_no IS 'Branch number from the company branch list';
COMMENT ON COLUMN locations.type IS 'pharmacy | nutrition | office | warehouse';
COMMENT ON COLUMN locations.status IS 'active | opening_soon | closed';
COMMENT ON COLUMN locations.map_url IS 'Google Maps link';
COMMENT ON COLUMN locations.ref_no_1 IS 'Reference number 1 (label configurable in Settings → Branches)';
COMMENT ON COLUMN locations.ref_no_2 IS 'Reference number 2 (label configurable in Settings → Branches)';
COMMENT ON COLUMN locations.opening_hours IS '{"mon":{"open":"09:00","close":"22:00","closed":false,"allDay":false}, … "sun":{…}}';
COMMENT ON COLUMN locations.manager_id IS 'Branch manager / pharmacist in charge';

-- Configurable labels for the two reference numbers
INSERT INTO settings (section, key, value) VALUES
  ('branches', 'refNo1Label', '"Reference no. 1"'),
  ('branches', 'refNo2Label', '"Reference no. 2"')
ON CONFLICT (section, key) DO NOTHING;
