import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { config } from "../config.js";
import { DbService } from "../database/db.service.js";
import { AccessService, HttpError, type Session } from "../domain/access.service.js";
import { Repo } from "../domain/repository.service.js";
import { CurrentSession, Public, clientIp, secretKey } from "./auth.guard.js";

const sha = (v: string) => crypto.createHash("sha256").update(v).digest("hex");

@Controller("auth")
export class AuthController {
  constructor(private readonly db: DbService, private readonly repo: Repo, private readonly access: AccessService) {}

  private async issue(res: Response, user: { id: string; email: string; name: string; role: string; employeeId: string | null }, req: Request) {
    const accessToken = await new SignJWT({ email: user.email, name: user.name, role: user.role, employeeId: user.employeeId })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(user.id)
      .setIssuedAt()
      .setExpirationTime(`${config.accessTtlMinutes}m`)
      .sign(secretKey());
    const refresh = crypto.randomBytes(48).toString("base64url");
    await this.db.query("INSERT INTO refresh_tokens (user_id, token_hash, user_agent, ip, expires_at) VALUES ($1,$2,$3,$4, now() + ($5 || ' days')::interval)", [user.id, sha(refresh), String(req.headers["user-agent"] ?? "").slice(0, 300), clientIp(req), String(config.refreshTtlDays)]);
    const base = { httpOnly: true, sameSite: "lax" as const, secure: config.cookieSecure, domain: config.cookieDomain, path: "/" };
    res.cookie("access_token", accessToken, { ...base, maxAge: config.accessTtlMinutes * 60000 });
    res.cookie("refresh_token", refresh, { ...base, maxAge: config.refreshTtlDays * 86400000 });
    return { accessToken, expiresIn: config.accessTtlMinutes * 60 };
  }

  @Public()
  @Post("login")
  @HttpCode(200)
  async login(@Body() body: { email?: string; password?: string }, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    if (!body.email || !body.password) throw new HttpError(400, "Email and password are required");
    const settings = await this.access.settings<{ security?: { maxFailedAttempts?: number; lockoutMinutes?: number } }>();
    const maxAttempts = settings.security?.maxFailedAttempts ?? 5;
    const lockMinutes = settings.security?.lockoutMinutes ?? 15;
    const user = (await this.repo.find("users", { email: body.email.trim().toLowerCase() }))[0];
    const meta = { ip: clientIp(req), userAgent: String(req.headers["user-agent"] ?? "") };
    if (!user) throw new HttpError(401, "Invalid email or password");
    if (!user.active) throw new HttpError(403, "This account is deactivated. Contact HR.");
    if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) throw new HttpError(423, `Account locked after too many failed attempts. Try again after ${new Date(user.lockedUntil).toLocaleTimeString("en-GB", { timeZone: "Asia/Dubai" })}.`);
    if (!(await bcrypt.compare(body.password, String(user.passwordHash)))) {
      const attempts = Number(user.failedAttempts ?? 0) + 1;
      const locked = attempts >= maxAttempts;
      await this.repo.update("users", user.id, { failedAttempts: locked ? 0 : attempts, lockedUntil: locked ? new Date(Date.now() + lockMinutes * 60000).toISOString() : null });
      await this.access.audit({ userId: user.id, name: user.name, role: user.role, ...meta }, "Login Failed", "users", user.id, { attempts });
      throw new HttpError(401, locked ? `Too many failed attempts. Account locked for ${lockMinutes} minutes.` : `Invalid email or password (${maxAttempts - attempts} attempt(s) left)`);
    }
    await this.repo.update("users", user.id, { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date().toISOString(), lastLoginIp: meta.ip });
    const session = { userId: user.id, email: user.email, name: user.name, role: user.role, employeeId: user.employeeId ?? null };
    const tokens = await this.issue(res, { id: user.id, email: user.email, name: user.name, role: user.role, employeeId: user.employeeId ?? null }, req);
    await this.access.audit({ ...session, ...meta }, "Login", "users", user.id);
    return { ...tokens, user: session };
  }

  @Public()
  @Post("refresh")
  @HttpCode(200)
  async refresh(@Req() req: Request, @Body() body: { refreshToken?: string }, @Res({ passthrough: true }) res: Response) {
    const token = (req.cookies?.refresh_token as string | undefined) ?? body?.refreshToken;
    if (!token) throw new HttpError(401, "No refresh token");
    const row = await this.db.one<{ id: string; user_id: string }>("SELECT id, user_id FROM refresh_tokens WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at > now()", [sha(token)]);
    if (!row) throw new HttpError(401, "Session expired — please sign in again");
    const user = await this.repo.get("users", row.user_id);
    if (!user || !user.active) throw new HttpError(401, "Account is no longer active");
    await this.db.query("UPDATE refresh_tokens SET revoked_at = now() WHERE id=$1", [row.id]);
    return this.issue(res, { id: user.id, email: user.email, name: user.name, role: user.role, employeeId: user.employeeId ?? null }, req);
  }

  @Public()
  @Post("logout")
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.refresh_token as string | undefined;
    if (token) await this.db.query("UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash=$1", [sha(token)]);
    const base = { path: "/", domain: config.cookieDomain };
    res.clearCookie("access_token", base);
    res.clearCookie("refresh_token", base);
    return { ok: true };
  }

  @Get("me")
  async me(@CurrentSession() s: Session) {
    const user = await this.repo.get("users", s.userId);
    if (!user || !user.active) throw new HttpError(401, "Account no longer active");
    const employee = s.employeeId ? await this.repo.get("employees", s.employeeId) : null;
    return {
      user: { ...s, ip: undefined, userAgent: undefined, lastLoginAt: user.lastLoginAt, mfaEnabled: user.mfaEnabled },
      employee,
      permissions: this.access.permissions(s.role),
      teamIds: [...(await this.access.reportsOf(s.employeeId))],
    };
  }

  @Post("change-password")
  @HttpCode(200)
  async changePassword(@CurrentSession() s: Session, @Body() body: { currentPassword: string; newPassword: string }) {
    const user = await this.repo.get("users", s.userId);
    if (!user) throw new HttpError(404, "User not found");
    if (!(await bcrypt.compare(body.currentPassword ?? "", String(user.passwordHash)))) throw new HttpError(400, "Current password is incorrect");
    await this.setPassword(user.id, body.newPassword);
    await this.access.audit(s, "Password Changed", "users", user.id);
    return { ok: true };
  }

  private async setPassword(userId: string, pwd: string) {
    const min = (await this.access.settings<{ security?: { passwordMinLength?: number } }>()).security?.passwordMinLength ?? 8;
    if (!pwd || pwd.length < min) throw new HttpError(400, `New password must be at least ${min} characters`);
    if (!/[A-Z]/.test(pwd) || !/[0-9]/.test(pwd)) throw new HttpError(400, "Password must include an uppercase letter and a number");
    await this.repo.update("users", userId, { passwordHash: bcrypt.hashSync(pwd, 10), passwordChangedAt: new Date().toISOString(), failedAttempts: 0, lockedUntil: null });
  }

  @Public()
  @Post("forgot-password")
  @HttpCode(200)
  async forgot(@Body() body: { email?: string }) {
    const user = body.email ? (await this.repo.find("users", { email: body.email.trim().toLowerCase() }))[0] : undefined;
    if (user?.active) {
      // Stateless single-use token: bound to the current password hash, so it stops working once used
      const token = await new SignJWT({ purpose: "reset", ph: sha(String(user.passwordHash)).slice(0, 16) }).setProtectedHeader({ alg: "HS256" }).setSubject(user.id).setExpirationTime("30m").sign(secretKey());
      const link = `${config.frontendUrl}/reset-password?token=${token}`;
      await this.db.query("INSERT INTO email_outbox (to_email, template, payload) VALUES ($1,'password-reset',$2)", [user.email, JSON.stringify({ name: user.name, link })]);
    }
    return { ok: true, message: "If the email exists, a reset link has been sent." };
  }

  @Public()
  @Post("reset-password")
  @HttpCode(200)
  async reset(@Body() body: { token?: string; newPassword?: string }) {
    try {
      const { payload } = await jwtVerify(String(body.token), secretKey());
      const user = await this.repo.get("users", String(payload.sub));
      if (payload.purpose !== "reset" || !user || payload.ph !== sha(String(user.passwordHash)).slice(0, 16)) throw new Error();
      await this.setPassword(user.id, String(body.newPassword ?? ""));
      await this.db.query("UPDATE refresh_tokens SET revoked_at = now() WHERE user_id=$1 AND revoked_at IS NULL", [user.id]);
      await this.access.audit({ userId: user.id, name: user.name, role: user.role }, "Password Reset", "users", user.id);
      return { ok: true };
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(400, "This reset link is invalid or has expired");
    }
  }

  @Get("sessions")
  async sessions(@CurrentSession() s: Session) {
    return this.db.query("SELECT id, user_agent AS \"userAgent\", ip, created_at AS \"createdAt\", expires_at AS \"expiresAt\" FROM refresh_tokens WHERE user_id=$1 AND revoked_at IS NULL AND expires_at > now() ORDER BY created_at DESC", [s.userId]);
  }

  @Delete("sessions/:id")
  async revoke(@CurrentSession() s: Session, @Param("id") id: string) {
    await this.db.query("UPDATE refresh_tokens SET revoked_at = now() WHERE id=$1 AND user_id=$2", [id, s.userId]);
    return { ok: true };
  }
}
