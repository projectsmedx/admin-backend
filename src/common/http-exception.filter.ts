import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from "@nestjs/common";
import { STATUS_CODES } from "node:http";
import type { Response } from "express";

/** Uniform error shape: { statusCode, error, message }. */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly log = new Logger("HTTP");

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    let status = 500;
    let message = "Internal server error";
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      message = typeof body === "string" ? body : Array.isArray((body as { message?: unknown }).message) ? ((body as { message: string[] }).message).join(", ") : String((body as { message?: unknown }).message ?? exception.message);
    } else {
      this.log.error(exception instanceof Error ? exception.stack : String(exception));
    }
    res.status(status).json({ statusCode: status, error: STATUS_CODES[status] ?? "Error", message });
  }
}
