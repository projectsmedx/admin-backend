import { HttpException, Injectable } from "@nestjs/common";
import { DbService } from "../database/db.service.js";
import { toApiEnum, toDbEnum, label } from "./enums.js";
import { DEF_BY_KEY, isUuid, loadApprovals, saveApprovals, type Def, type Field, type Helpers, type Row } from "./resources.js";

type Where = Record<string, unknown>;

/** Generic data access over the resource definitions. All methods speak API-shaped objects. */
@Injectable()
export class Repo {
  readonly h: Helpers;
  constructor(private readonly db: DbService) {
    this.h = {
      q: (sql, params) => this.db.query(sql, params),
      one: (sql, params) => this.db.one(sql, params),
      fileId: (v) => this.fileId(v),
      userIdForEmployee: async (empId) => (empId ? ((await this.db.one<{ id: string }>("SELECT id FROM users WHERE employee_id=$1", [empId]))?.id ?? null) : null),
    };
  }

  def(key: string): Def {
    const d = DEF_BY_KEY.get(key);
    if (!d) throw new Error(`Unknown resource ${key}`);
    return d;
  }

  // ----------------------------------------------------------------------- reads
  async all<T extends Row = Row>(key: string, where: Where = {}, opts: { limit?: number; orderBy?: string; includeDeleted?: boolean } = {}): Promise<T[]> {
    const def = this.def(key);
    const params: unknown[] = [];
    const conds: string[] = [];
    const memory: [string, unknown][] = [];
    for (const [k, v] of Object.entries(where)) {
      if (v === undefined) continue;
      if (k === "id") {
        params.push(v);
        conds.push(Array.isArray(v) ? `id = ANY($${params.length})` : `id = $${params.length}`);
        continue;
      }
      const fl = def.fields.find((x) => x.api === k && x.col && !x.get && x.kind !== "file");
      if (!fl) {
        memory.push([k, v]);
        continue;
      }
      if (v === null) {
        conds.push(`${fl.col} IS NULL`);
        continue;
      }
      const conv = (x: unknown) => this.toDbValue(fl, x);
      if (Array.isArray(v)) {
        params.push(v.map(conv));
        conds.push(`${fl.col} = ANY($${params.length})`);
      } else {
        params.push(conv(v));
        conds.push(`${fl.col} = $${params.length}`);
      }
    }
    if (def.softDelete && !opts.includeDeleted) conds.push("deleted_at IS NULL");
    const sql = `SELECT * FROM ${def.table}${conds.length ? ` WHERE ${conds.join(" AND ")}` : ""} ORDER BY ${opts.orderBy ?? def.orderBy ?? "created_at"}${opts.limit ? ` LIMIT ${Number(opts.limit)}` : ""}`;
    const raw = await this.db.query(sql, params);
    let rows = raw.map((r) => this.toApi(def, r));
    await this.enrich(def, rows);
    for (const [k, v] of memory) rows = rows.filter((r) => (Array.isArray(v) ? v.includes(r[k]) : String(r[k] ?? "") === String(v)));
    return rows as T[];
  }

  async get<T extends Row = Row>(key: string, id: string | null | undefined, opts: { includeDeleted?: boolean } = {}): Promise<T | undefined> {
    if (!id || !isUuid(id)) return undefined;
    return (await this.all<T>(key, { id }, opts))[0];
  }

  async find<T extends Row = Row>(key: string, where: Where): Promise<T[]> {
    return this.all<T>(key, where);
  }

  private async enrich(def: Def, rows: Row[]) {
    if (!rows.length) return;
    const fileFields = def.fields.filter((f) => f.kind === "file");
    if (fileFields.length) {
      const fileIds = [...new Set(rows.flatMap((r) => fileFields.map((f) => r[f.api])).filter(Boolean))];
      const files = fileIds.length ? await this.db.query<{ id: string; file_name: string }>("SELECT id, file_name FROM files WHERE id = ANY($1)", [fileIds]) : [];
      const m = new Map(files.map((x) => [x.id, x.file_name]));
      for (const r of rows) for (const f of fileFields) r[f.api] = r[f.api] ? (m.get(r[f.api]) ?? null) : null;
    }
    if (def.approvals) await loadApprovals(rows, def.approvals, this.h);
    if (def.load) await def.load(rows, this.h);
  }

  // ----------------------------------------------------------------------- writes
  async insert<T extends Row = Row>(key: string, data: Row | Record<string, unknown>, opts: { fetch?: boolean } = {}): Promise<T> {
    const def = this.def(key);
    return this.db.tx(async () => {
      const input = { ...data } as Row;
      if (def.code && def.fields.some((f) => f.api === "code") && !input.code) input.code = await this.nextCode(def);
      const cols = await this.toDbColumns(def, input, undefined);
      if (input.createdAt && def.fields.some((f) => f.api === "createdAt")) cols.created_at = input.createdAt;
      if (input.id && isUuid(input.id)) cols.id = input.id;
      const names = Object.keys(cols);
      if (!names.length) throw new HttpException("Request body is empty — provide the fields to create", 400);
      const row = await this.db.one<{ id: string }>(
        `INSERT INTO ${def.table} (${names.join(", ")}) VALUES (${names.map((_, k) => `$${k + 1}`).join(", ")}) RETURNING id`,
        names.map((n) => cols[n]),
      ).catch((e) => this.pgError(e));
      const id = row!.id;
      if (def.approvals) await saveApprovals(id, def.approvals, input.approvals, this.h);
      if (def.save) await def.save(id, input, this.h, undefined);
      if (opts.fetch === false) return { id } as T;
      return (await this.get<T>(key, id, { includeDeleted: true }))!;
    });
  }

  async update<T extends Row = Row>(key: string, id: string, patch: Record<string, unknown>): Promise<T | undefined> {
    const def = this.def(key);
    return this.db.tx(async () => {
      const existing = await this.get(key, id, { includeDeleted: true });
      if (!existing) return undefined;
      const cols = await this.toDbColumns(def, patch as Row, existing);
      if (def.fields.some((f) => f.api === "updatedAt") || (await this.hasColumn(def.table, "updated_at"))) cols.updated_at = new Date().toISOString();
      const names = Object.keys(cols);
      if (names.length) {
        await this.db
          .query(`UPDATE ${def.table} SET ${names.map((n, k) => `${n} = $${k + 2}`).join(", ")} WHERE id = $1`, [id, ...names.map((n) => cols[n])])
          .catch((e) => this.pgError(e));
      }
      if (def.approvals) await saveApprovals(id, def.approvals, (patch as Row).approvals, this.h);
      if (def.save) await def.save(id, patch as Row, this.h, existing);
      return this.get<T>(key, id, { includeDeleted: true });
    });
  }

  async remove(key: string, id: string): Promise<boolean> {
    const def = this.def(key);
    return this.db.tx(async () => {
      if (def.softDelete) {
        const r = await this.db.query("UPDATE " + def.table + " SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING id", [id]);
        return r.length > 0;
      }
      for (const [table, fk] of def.children ?? []) await this.db.query(`DELETE FROM ${table} WHERE ${fk} = $1`, [id]);
      if (def.approvals) await this.db.query("DELETE FROM approval_steps WHERE entity_type=$1 AND entity_id=$2", [def.approvals, id]);
      const r = await this.db.query(`DELETE FROM ${def.table} WHERE id = $1 RETURNING id`, [id]).catch((e) => this.pgError(e));
      return (r as unknown[]).length > 0;
    });
  }

  // ----------------------------------------------------------------------- mapping
  toApi(def: Def, r: Record<string, any>): Row {
    const out: Row = { id: r.id };
    for (const f of def.fields) {
      if (f.get) out[f.api] = f.get(r);
      else if (f.col) out[f.api] = this.fromDbValue(f, r[f.col]);
    }
    return out;
  }

  private fromDbValue(f: Field, v: any) {
    if (v === null || v === undefined) return f.kind === "arr" ? [] : null;
    switch (f.kind) {
      case "ts": return v instanceof Date ? v.toISOString() : v;
      case "enum": return toApiEnum(f.enumName!, v);
      case "lc": return label(String(v));
      default: return v;
    }
  }

  private toDbValue(f: Field, v: any) {
    if (v === undefined) return undefined;
    if (v === "" && f.kind !== "text") return null;
    try {
      switch (f.kind) {
        case "enum": return toDbEnum(f.enumName!, v);
        case "lc": return v === null ? null : String(v).trim().toLowerCase().replace(/\s+/g, "_");
        case "num": return v === null ? null : Number(v);
        case "int": return v === null ? null : Math.round(Number(v));
        case "bool": return v === null ? null : !!v;
        case "json": return v === null ? null : JSON.stringify(v);
        case "arr": return Array.isArray(v) ? v : v ? String(v).split(",").map((s) => s.trim()).filter(Boolean) : [];
        case "date": return v ? String(v).slice(0, 10) : null;
        default: return v === "" ? null : v;
      }
    } catch (e) {
      throw new HttpException((e as Error).message, 400);
    }
  }

  private async toDbColumns(def: Def, data: Row, existing: Row | undefined) {
    const cols: Record<string, unknown> = {};
    for (const f of def.fields) {
      if (f.ro || !(f.api in data) || !f.col || data[f.api] === undefined) continue;
      const v = data[f.api];
      if (f.set) Object.assign(cols, await f.set(v, data, existing, this.h));
      else if (f.kind === "file") cols[f.col] = await this.fileId(v);
      else cols[f.col] = this.toDbValue(f, v);
    }
    return cols;
  }

  /** Accepts a file id or a plain file name (creates a metadata row until real uploads are used). */
  async fileId(v: unknown): Promise<string | null> {
    if (!v) return null;
    if (isUuid(v)) return v as string;
    const name = String(v);
    const r = await this.db.one<{ id: string }>(
      "INSERT INTO files (storage_key, file_name, mime_type, size_bytes) VALUES ($1,$2,$3,0) RETURNING id",
      [`placeholder/${crypto.randomUUID()}/${name}`, name, name.endsWith(".pdf") ? "application/pdf" : name.match(/\.(jpe?g|png)$/) ? "image/jpeg" : "application/octet-stream"],
    );
    return r!.id;
  }

  async nextCode(def: Def): Promise<string> {
    if (def.key === "employees") {
      // Employee IDs follow Settings → HR → employeeIdPrefix (e.g. "MEDX" → MEDX325)
      const row = await this.db.one<{ value: unknown }>("SELECT value FROM settings WHERE section='hr' AND key='employeeIdPrefix'");
      const prefix = typeof row?.value === "string" && row.value ? row.value : "EMP-";
      const esc = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const m = await this.db.one<{ n: number | null }>(`SELECT max(substring(code from '([0-9]+)$')::int) AS n FROM employees WHERE code ~* $1`, [`^${esc}[0-9]+$`]);
      return `${prefix}${(m?.n ?? 0) + 1}`;
    }
    const r = await this.db.one<{ n: number | null }>(`SELECT max(substring(code from '([0-9]+)$')::int) AS n FROM ${def.table}`);
    const next = (r?.n ?? (def.code === "TKT" ? 1000 : def.code === "EMP" ? 1000 : 0)) + 1;
    return `${def.code}-${def.code === "AST" ? String(next).padStart(4, "0") : next}`;
  }

  private columnCache = new Map<string, boolean>();
  private async hasColumn(table: string, col: string) {
    const k = `${table}.${col}`;
    if (!this.columnCache.has(k)) {
      const r = await this.db.one("SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2", [table, col]);
      this.columnCache.set(k, !!r);
    }
    return this.columnCache.get(k)!;
  }

  pgError(e: any): never {
    const code = e?.code as string | undefined;
    if (code === "23505") throw new HttpException(`Duplicate value: ${e.detail ?? "already exists"}`, 409);
    if (code === "23503") throw new HttpException(e.detail?.includes("is still referenced") ? "This record is used by other records and cannot be deleted" : `Invalid reference: ${e.detail ?? e.message}`, 409);
    if (code === "23502") throw new HttpException(`Missing required field: ${e.column}`, 400);
    if (code === "22P02" || code === "22007" || code === "22008") throw new HttpException(`Invalid value: ${e.message}`, 400);
    if (code === "23514") throw new HttpException(`Invalid value: ${e.message}`, 400);
    throw e;
  }
}
