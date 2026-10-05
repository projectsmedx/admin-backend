import type { Response } from "express";
import { AccessService, HttpError, type Session } from "../domain/access.service.js";
import { Repo } from "../domain/repository.service.js";
import { DEF_BY_KEY, isUuid, type Row } from "../domain/resources.js";
import type { Action } from "../domain/rbac.js";

/** Loads a record, checks permission + scope, applies a patch and writes an audit entry. */
export async function mutate(repo: Repo, access: AccessService, s: Session, key: string, id: string, action: Action, fn: (r: Row) => Promise<Record<string, unknown>> | Record<string, unknown>, auditAction = "Updated") {
  const def = DEF_BY_KEY.get(key)!;
  access.assertCan(s, def.resource, action);
  if (!isUuid(id)) throw new HttpError(404, "Record not found");
  const record = await repo.get(key, id);
  if (!record) throw new HttpError(404, "Record not found");
  await access.assertInScope(s, key, def.resource, record);
  const patch = await fn(record);
  const updated = await repo.update(key, id, patch);
  await access.audit(s, auditAction, key, id, { code: record.code, changes: access.diff(record, patch) });
  return (await access.filterByScope(s, key, def.resource, [updated!]))[0] ?? updated;
}

export function sendCsv(res: Response, filename: string, rows: Record<string, unknown>[]) {
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const esc = (v: unknown) => {
    const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(csv);
}

export const todayIso = () => new Date().toISOString().slice(0, 10);
/** Today's date in Dubai (UTC+4). */
export const dubaiToday = () => new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);
export const dubaiNowHHMM = () => new Date(Date.now() + 4 * 3600000).toISOString().slice(11, 16);
