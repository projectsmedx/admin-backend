// Central configuration read from environment variables (see .env.example).
import fs from "node:fs";

// Load backend/.env for local development (real environment variables take precedence)
if (fs.existsSync(".env")) {
  for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const env = (k: string, d?: string) => process.env[k] ?? d ?? "";
// Secrets have no fallback: the app refuses to start without them
const required = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing required environment variable ${k} (see .env.example)`);
  return v;
};

export const config = {
  port: Number(env("PORT", "4000")),
  databaseUrl: required("DATABASE_URL"),
  // "auto" (default): SSL for any host other than localhost; "true"/"false" to force
  databaseSsl: env("DATABASE_SSL", "auto"),
  frontendUrl: env("FRONTEND_URL", "http://localhost:3000"),
  jwtSecret: required("JWT_SECRET"),
  accessTtlMinutes: Number(env("ACCESS_TOKEN_TTL_MINUTES", "15")),
  refreshTtlDays: Number(env("REFRESH_TOKEN_TTL_DAYS", "7")),
  cookieSecure: env("COOKIE_SECURE", "false") === "true",
  cookieDomain: env("COOKIE_DOMAIN") || undefined,
  runMigrations: env("RUN_MIGRATIONS", "true") !== "false",
  seedOnStart: env("SEED_ON_START", "false") === "true",
  seedDate: env("SEED_DATE"),
  // Initial password for logins created from the employee form when none is entered
  defaultUserPassword: env("DEFAULT_USER_PASSWORD"),
  // Domain for work emails generated when a hired candidate becomes an employee
  companyEmailDomain: env("COMPANY_EMAIL_DOMAIN", "medxpharmacy.com"),
  smtp: {
    host: env("SMTP_HOST", "localhost"),
    port: Number(env("SMTP_PORT", "1025")),
    user: env("SMTP_USER"),
    pass: env("SMTP_PASS"),
    secure: env("SMTP_SECURE", "false") === "true",
    from: env("MAIL_FROM", "MedxDashboard <hr@medxpharmacy.com>"),
  },
  // Files: Supabase Storage when SUPABASE_URL is set, otherwise the local UPLOAD_DIR
  storage: {
    supabaseUrl: env("SUPABASE_URL"),
    serviceRoleKey: env("SUPABASE_SERVICE_ROLE_KEY"),
    bucket: env("SUPABASE_BUCKET"),
  },
  maxUploadMb: Number(env("MAX_UPLOAD_MB", "50")),
  uploadDir: env("UPLOAD_DIR", "./uploads"),
};
