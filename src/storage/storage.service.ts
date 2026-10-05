import { Injectable, Logger } from "@nestjs/common";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

/**
 * Where uploaded files live. With SUPABASE_URL set, objects go to the Supabase Storage bucket
 * (private; read through short-lived signed URLs). Without it, files are written to UPLOAD_DIR
 * for local development.
 */
@Injectable()
export class StorageService {
  private readonly log = new Logger("Storage");
  private readonly s = config.storage;
  readonly driver = this.s.supabaseUrl ? "supabase" : "local";

  constructor() {
    if (this.driver === "supabase" && (!this.s.serviceRoleKey || !this.s.bucket))
      throw new Error("SUPABASE_URL is set, so SUPABASE_SERVICE_ROLE_KEY and SUPABASE_BUCKET are required too");
  }

  private api(p: string, init: RequestInit = {}) {
    return fetch(`${this.s.supabaseUrl.replace(/\/$/, "")}/storage/v1${p}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.s.serviceRoleKey}`, apikey: this.s.serviceRoleKey, ...init.headers },
    });
  }

  private objectPath(key: string) {
    return `${encodeURIComponent(this.s.bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`;
  }

  private async fail(what: string, r: Response): Promise<never> {
    throw new Error(`Supabase Storage ${what} failed (${r.status}): ${await r.text()}`);
  }

  async put(key: string, body: Buffer, mimeType: string) {
    if (this.driver === "local") {
      const full = path.resolve(config.uploadDir, key);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, body);
      return;
    }
    const r = await this.api(`/object/${this.objectPath(key)}`, { method: "POST", body: new Uint8Array(body), headers: { "Content-Type": mimeType, "x-upsert": "false" } });
    if (!r.ok) await this.fail("upload", r);
  }

  /** Short-lived link that downloads the object under its original name (Supabase only). */
  async signedUrl(key: string, fileName: string, expiresIn = 300) {
    const r = await this.api(`/object/sign/${this.objectPath(key)}`, { method: "POST", body: JSON.stringify({ expiresIn }), headers: { "Content-Type": "application/json" } });
    if (!r.ok) await this.fail("signed URL", r);
    const { signedURL } = (await r.json()) as { signedURL: string };
    return `${this.s.supabaseUrl.replace(/\/$/, "")}/storage/v1${signedURL}&download=${encodeURIComponent(fileName)}`;
  }

  /** Local driver only: path on disk, or null when the file is missing. */
  localPath(key: string) {
    const full = path.resolve(config.uploadDir, key);
    return fs.existsSync(full) ? full : null;
  }

  async remove(key: string) {
    if (this.driver === "local") return fs.rmSync(path.resolve(config.uploadDir, key), { force: true });
    const r = await this.api(`/object/${encodeURIComponent(this.s.bucket)}`, { method: "DELETE", body: JSON.stringify({ prefixes: [key] }), headers: { "Content-Type": "application/json" } });
    if (!r.ok) await this.fail("delete", r);
  }

  /** One-line status for the startup log. */
  async status() {
    if (this.driver === "local") return `local disk (${path.resolve(config.uploadDir)})`;
    const r = await this.api(`/bucket/${encodeURIComponent(this.s.bucket)}`);
    if (!r.ok) {
      this.log.error(`Bucket "${this.s.bucket}" is not reachable (${r.status}): ${await r.text()}`);
      return `Supabase bucket "${this.s.bucket}" — NOT reachable`;
    }
    const b = (await r.json()) as { public: boolean; file_size_limit: number | null };
    return `Supabase bucket "${this.s.bucket}" · ${b.public ? "public" : "private"} · limit ${b.file_size_limit ? Math.round(b.file_size_limit / 1048576) + " MB" : "project default"}`;
  }
}
