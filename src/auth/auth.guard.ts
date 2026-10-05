import { CanActivate, ExecutionContext, Injectable, SetMetadata, UnauthorizedException, createParamDecorator } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { jwtVerify } from "jose";
import { config } from "../config.js";
import type { Session } from "../domain/access.service.js";

export const IS_PUBLIC = "isPublic";
/** Marks a route as accessible without signing in. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const secretKey = () => new TextEncoder().encode(config.jwtSecret);

export function clientIp(req: Request) {
  return String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || req.ip || "127.0.0.1";
}

/** Verifies the access token from `Authorization: Bearer` or the `access_token` cookie. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext) {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest<Request & { session?: Session }>();
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : (req.cookies?.access_token as string | undefined);
    if (!token) throw new UnauthorizedException("Not authenticated");
    try {
      const { payload } = await jwtVerify(token, secretKey());
      req.session = {
        userId: String(payload.sub),
        email: String(payload.email),
        name: String(payload.name),
        role: payload.role as Session["role"],
        employeeId: (payload.employeeId as string | null) ?? null,
        ip: clientIp(req),
        userAgent: String(req.headers["user-agent"] ?? ""),
      };
      return true;
    } catch {
      throw new UnauthorizedException("Session expired");
    }
  }
}

/** Injects the signed-in user's session into a controller method. */
export const CurrentSession = createParamDecorator((_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<{ session: Session }>().session);
