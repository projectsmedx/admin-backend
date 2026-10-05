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

export const config = {
  port: Number(env("PORT", "4000")),
  databaseUrl: env("DATABASE_URL", "postgres://medx:medx@localhost:5433/medx_hr"),
  frontendUrl: env("FRONTEND_URL", "http://localhost:3000"),
  jwtSecret: env("JWT_SECRET", "dev-only-change-me-medx-hr-jwt-secret-32+chars"),
  accessTtlMinutes: Number(env("ACCESS_TOKEN_TTL_MINUTES", "15")),
  refreshTtlDays: Number(env("REFRESH_TOKEN_TTL_DAYS", "7")),
  cookieSecure: env("COOKIE_SECURE", "false") === "true",
  cookieDomain: env("COOKIE_DOMAIN") || undefined,
  runMigrations: env("RUN_MIGRATIONS", "true") !== "false",
  seedOnStart: env("SEED_ON_START", "true") !== "false",
  seedDate: env("SEED_DATE"),
  smtp: {
    host: env("SMTP_HOST", "localhost"),
    port: Number(env("SMTP_PORT", "1025")),
    user: env("SMTP_USER"),
    pass: env("SMTP_PASS"),
    secure: env("SMTP_SECURE", "false") === "true",
    from: env("MAIL_FROM", "MedxDashboard <hr@medxpharmacy.com>"),
  },
  uploadDir: env("UPLOAD_DIR", "./uploads"),
};
