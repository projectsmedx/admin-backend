# MedxDashboard — API (NestJS + PostgreSQL)

REST API for the MedxDashboard platform. Global prefix `/api/v1`, Swagger UI at `/api/docs`.

## What happens on start

1. Waits for PostgreSQL (`DATABASE_URL`).
2. Applies pending migrations from `src/database/migrations/*.sql`, tracked in the `schema_migrations` table. `001_initial.sql` creates all 72 tables.
3. If `SEED_ON_START=true` and the `users` table is empty, seeds the company setup (departments, designations, shifts, leave types, holidays, settings) and the employees in `src/database/data/employees.json`, each with a login. Logins are saved to `../medx-logins-<date>.csv`.
4. Loads the role permission matrix from `roles` / `role_permissions`.

Set `RUN_MIGRATIONS=false` or `SEED_ON_START=false` to turn steps off.

## Commands

```bash
npm install
cp .env.example .env              # already present for local dev
npm run start:dev                 # watch mode (needs PostgreSQL — `docker compose up -d db mailpit` starts one on port 5433)
npm run build && npm run start:prod
npm run db:migrate                # apply migrations only
npm run db:seed                   # migrate + seed if empty
npm run db:reset                  # DROP everything, migrate, reseed
```

## Structure

| Path | Purpose |
|---|---|
| `src/main.ts` | Startup sequence, CORS, cookies, helmet, Swagger |
| `src/database/` | pg pool + transactions, migrator, seed generator |
| `src/domain/resources.ts` | Mapping between API objects and tables (incl. child tables) for every resource |
| `src/domain/repository.service.ts` | Generic list/get/insert/update/delete over those mappings |
| `src/domain/access.service.ts` | Permissions (from DB), data scopes, sensitive-field masking, audit log, notifications |
| `src/domain/hooks.service.ts` | Validation, defaults, side effects per resource |
| `src/domain/workflows.service.ts` | Approval/state transitions (`POST /:resource/:id/:action`) |
| `src/auth/` | Login, rotating refresh tokens, lockout, password reset, sessions |
| `src/modules/` | Dashboard, directory, settings, roles, notifications, files, employees extras, attendance, leave, payroll, WPS, payslips, settlements, generic CRUD |
| `src/jobs/` | Email outbox sender (SMTP) every 30 s, document-expiry reminders daily at 07:00 Dubai |

## Adding a field or table

1. Add a new migration, e.g. `src/database/migrations/002_add_x.sql`. Never edit an applied migration.
2. Map the column in `src/domain/resources.ts`.
3. Document it in `../docs/build/spec.mjs` and run `npm run docs` at the repo root.

Full reference (every table, column and endpoint): `../docs/MedX-HR-Documentation.pdf`, or open `../docs/MedX-HR-Documentation.html`.
# admin-backend
