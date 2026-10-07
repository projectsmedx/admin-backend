-- Employee media: photo, ID / passport / visa scans, degrees and other images, one row per file.
-- `slot` says what the file is (see src/domain/media.ts); single-file slots keep only the latest upload.
CREATE TABLE IF NOT EXISTS employee_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
  slot text NOT NULL,
  file_id uuid NOT NULL REFERENCES files (id) ON DELETE CASCADE,
  note text,
  uploaded_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_employee_media_employee ON employee_media (employee_id, slot);
CREATE UNIQUE INDEX IF NOT EXISTS ux_employee_media_file ON employee_media (file_id);
COMMENT ON TABLE employee_media IS 'Employee photo and document images stored in the files bucket';
COMMENT ON COLUMN employee_media.slot IS 'e.g. profile_photo, emirates_id_front, passport_back, degree, other';
DROP TRIGGER IF EXISTS trg_employee_media_updated ON employee_media;
CREATE TRIGGER trg_employee_media_updated BEFORE UPDATE ON employee_media FOR EACH ROW EXECUTE FUNCTION set_updated_at();
