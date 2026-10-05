import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import nodemailer from "nodemailer";
import { config } from "../config.js";
import { DbService } from "../database/db.service.js";
import { AccessService } from "../domain/access.service.js";

type Outbox = { id: string; to_email: string; template: string; payload: Record<string, string>; attempts: number };

const esc = (s: string) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function render(o: Outbox) {
  const p = o.payload ?? {};
  const button = (href: string, text: string) => `<p><a href="${esc(href)}" style="display:inline-block;background:#90000c;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">${esc(text)}</a></p>`;
  const wrap = (body: string) => `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:auto;color:#151a2d"><h2 style="color:#90000c">MedxDashboard</h2>${body}<p style="color:#888;font-size:12px">You received this email from MedxDashboard. Manage notifications in your profile.</p></div>`;
  if (o.template === "password-reset") {
    return { subject: "Reset your MedxDashboard password", html: wrap(`<p>Hi ${esc(p.name)},</p><p>Use the button below to set a new password. The link expires in 30 minutes.</p>${button(p.link, "Reset password")}<p>If you didn't ask for this, ignore this email.</p>`) };
  }
  const link = p.link?.startsWith("http") ? p.link : `${config.frontendUrl}${p.link ?? "/"}`;
  return { subject: p.title ?? "MedxDashboard notification", html: wrap(`<p>Hi ${esc(p.name)},</p><p><strong>${esc(p.title)}</strong></p><p>${esc(p.message)}</p>${button(link, "Open MedxDashboard")}`) };
}

/** Background jobs: sends queued emails and creates document-expiry reminders. */
@Injectable()
export class JobsService {
  private readonly log = new Logger("Jobs");
  private readonly transport = nodemailer.createTransport({ host: config.smtp.host, port: config.smtp.port, secure: config.smtp.secure, auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined });
  private sending = false;

  constructor(private readonly db: DbService, private readonly access: AccessService) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async sendEmails() {
    if (this.sending) return;
    this.sending = true;
    try {
      const batch = await this.db.query<Outbox>("SELECT id, to_email, template, payload, attempts FROM email_outbox WHERE status='queued' AND attempts < 5 ORDER BY created_at LIMIT 25");
      for (const o of batch) {
        try {
          const { subject, html } = render(o);
          const info = await this.transport.sendMail({ from: config.smtp.from, to: o.to_email, subject, html });
          await this.db.query("UPDATE email_outbox SET status='sent', sent_at=now(), provider_message_id=$2, attempts=attempts+1, updated_at=now() WHERE id=$1", [o.id, info.messageId]);
        } catch (e) {
          await this.db.query("UPDATE email_outbox SET attempts=attempts+1, error=$2, status=CASE WHEN attempts+1 >= 5 THEN 'failed' ELSE 'queued' END, updated_at=now() WHERE id=$1", [o.id, (e as Error).message]);
          if (o.attempts === 0) this.log.warn(`Email to ${o.to_email} failed: ${(e as Error).message} (is SMTP running? see SMTP_HOST)`);
        }
      }
    } finally {
      this.sending = false;
    }
  }

  /** Daily at 07:00 Dubai (03:00 UTC): remind employees and HR about documents expiring in 90/60/30/7 days. */
  @Cron("0 3 * * *")
  async documentReminders() {
    const settings = await this.access.settings<{ notifications?: { documentExpiryReminderDays?: number[] } }>();
    const thresholds = (settings.notifications?.documentExpiryReminderDays ?? [90, 60, 30, 7]).map(Number).sort((a, b) => b - a);
    const docs = await this.db.query<{ id: string; type: string; employee_id: string; expiry_date: string; days: number }>(
      "SELECT id, type, employee_id, expiry_date::text, (expiry_date - current_date) AS days FROM documents WHERE employee_id IS NOT NULL AND expiry_date BETWEEN current_date AND current_date + $1::int",
      [thresholds[0] ?? 90],
    );
    let sent = 0;
    for (const d of docs) {
      const threshold = [...thresholds].reverse().find((t) => d.days <= t);
      if (threshold === undefined) continue;
      const done = await this.db.one("SELECT 1 FROM document_reminders WHERE document_id=$1 AND days_before=$2", [d.id, threshold]);
      if (done) continue;
      await this.access.notify({ employeeId: d.employee_id }, `${d.type} expires in ${d.days} days`, `Your ${d.type} expires on ${d.expiry_date}. Please upload the renewed document.`, "/documents");
      if (threshold <= 30) await this.access.notify({ role: "hr" }, `${d.type} expiring (${d.days}d)`, `${await this.access.employeeName(d.employee_id)} — ${d.type} expires on ${d.expiry_date}.`, "/documents");
      await this.db.query("INSERT INTO document_reminders (document_id, days_before) VALUES ($1,$2) ON CONFLICT DO NOTHING", [d.id, threshold]);
      sent++;
    }
    if (sent) this.log.log(`Created ${sent} document expiry reminder(s)`);
  }
}
