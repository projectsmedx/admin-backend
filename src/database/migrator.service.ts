import { Injectable, Logger } from "@nestjs/common";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DbService } from "./db.service.js";

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

/** Applies every migrations/NNN_*.sql file once, in order, each inside a transaction. */
@Injectable()
export class MigratorService {
  private readonly log = new Logger("Migrations");
  constructor(private readonly db: DbService) {}

  async run() {
    await this.db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const applied = new Set((await this.db.query<{ name: string }>("SELECT name FROM schema_migrations")).map((r) => r.name));
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
    let count = 0;
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      this.log.log(`Applying ${file}…`);
      await this.db.tx(async () => {
        await this.db.query(sql);
        await this.db.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      });
      count++;
    }
    this.log.log(count ? `${count} migration(s) applied` : "Database schema is up to date");
  }
}
