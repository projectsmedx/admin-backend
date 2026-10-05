import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { AsyncLocalStorage } from "node:async_hooks";
import pg from "pg";
import { config } from "../config.js";

// Return DATE as 'YYYY-MM-DD', NUMERIC/BIGINT as numbers, TIME as 'HH:MM'
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(1083, (v) => (v ? v.slice(0, 5) : v));

/**
 * Thin wrapper over node-postgres. `tx()` opens a transaction that every `query()` inside the
 * callback joins automatically (AsyncLocalStorage), so services never pass clients around.
 */
@Injectable()
export class DbService implements OnModuleDestroy {
  private readonly log = new Logger("Database");
  readonly pool = new pg.Pool({ connectionString: config.databaseUrl, max: 15 });
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

  async onModuleDestroy() {
    await this.pool.end();
  }
}
