import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { AsyncLocalStorage } from "node:async_hooks";
import pg from "pg";
import { config } from "../config.js";

// Return DATE as 'YYYY-MM-DD', NUMERIC/BIGINT as numbers, TIME as 'HH:MM'
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(1083, (v) => (v ? v.slice(0, 5) : v));

// Hosted databases (Supabase, Render) need SSL; a local docker Postgres does not.
// The connection is encrypted; the certificate is not verified because Supabase signs it with its own CA.
function useSsl() {
  if (config.databaseSsl !== "auto") return config.databaseSsl === "true";
  const host = new URL(config.databaseUrl).hostname;
  return !["localhost", "127.0.0.1", "::1", "postgres", "db"].includes(host);
}

/**
 * Thin wrapper over node-postgres. `tx()` opens a transaction that every `query()` inside the
 * callback joins automatically (AsyncLocalStorage), so services never pass clients around.
 */
@Injectable()
export class DbService implements OnModuleDestroy {
  private readonly log = new Logger("Database");
  readonly pool = new pg.Pool({ connectionString: config.databaseUrl, max: 15, ssl: useSsl() ? { rejectUnauthorized: false } : false });
  private readonly als = new AsyncLocalStorage<{ client: pg.PoolClient; chain: Promise<unknown> }>();

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const store = this.als.getStore();
    if (!store) return (await this.pool.query(sql, params as unknown[])).rows as T[];
    // A transaction uses one connection: run its queries one after another
    const run = store.chain.then(() => store.client.query(sql, params as unknown[]));
    store.chain = run.catch(() => undefined);
    return (await run).rows as T[];
  }

  async one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    return (await this.query<T>(sql, params))[0];
  }

  async tx<T>(fn: () => Promise<T>): Promise<T> {
    if (this.als.getStore()) return fn(); // already inside a transaction
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const out = await this.als.run({ client: c, chain: Promise.resolve() }, fn);
      await c.query("COMMIT");
      return out;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }

  /** Waits for the database to accept connections (useful when started together with docker compose). */
  async waitUntilReady(attempts = 30) {
    for (let i = 1; i <= attempts; i++) {
      try {
        await this.pool.query("SELECT 1");
        return;
      } catch (e) {
        this.log.warn(`Database not ready (${i}/${attempts}): ${(e as Error).message}`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    throw new Error("Could not connect to PostgreSQL. Check DATABASE_URL.");
  }

  /** Connection details for logs and the health check. The password is never included. */
  async status() {
    const started = Date.now();
    const client = await this.pool.connect();
    let r: { version: string; database: string; user: string; tables: number; now: string };
    let ssl: boolean;
    try {
      ({ rows: [r] } = await client.query(
        `SELECT split_part(version(), ' on ', 1) AS version, current_database() AS database, current_user AS user,
                (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public') AS tables, now()::text AS now`,
      ));
      // Is this app's own link encrypted? (pg_stat_ssl would only describe the pooler's link behind Supabase)
      ssl = Boolean((client as unknown as { connection: { stream: { encrypted?: boolean } } }).connection.stream.encrypted);
    } finally {
      client.release();
    }
    const url = new URL(config.databaseUrl);
    return {
      host: url.hostname,
      port: Number(url.port || 5432),
      latencyMs: Date.now() - started,
      pool: { total: this.pool.totalCount, idle: this.pool.idleCount, waiting: this.pool.waitingCount },
      ssl,
      ...r,
    };
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
