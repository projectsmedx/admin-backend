import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { SwaggerModule } from "@nestjs/swagger";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import fs from "node:fs";
import path from "node:path";
import { AppModule } from "./app.module.js";
import { config } from "./config.js";
import { DbService } from "./database/db.service.js";
import { MigratorService } from "./database/migrator.service.js";
import { SeederService } from "./database/seed/seeder.service.js";
import { AccessService } from "./domain/access.service.js";
import { StorageService } from "./storage/storage.service.js";
import { HttpExceptionFilter } from "./common/http-exception.filter.js";

async function bootstrap() {
  const log = new Logger("Bootstrap");
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.set("trust proxy", 1);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cookieParser());
  app.enableCors({ origin: config.frontendUrl.split(","), credentials: true });
  app.setGlobalPrefix("api/v1");
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useBodyParser("json", { limit: "5mb" });

  // 1) connect  2) create/upgrade tables  3) seed demo data when empty  4) load the permission matrix
  const db = app.get(DbService);
  await db.waitUntilReady();
  const s = await db.status();
  log.log(`Connected to PostgreSQL · ${s.host}:${s.port}/${s.database} as ${s.user} · ${s.version} · SSL ${s.ssl ? "on" : "off"} · ${s.tables} tables · ${s.latencyMs} ms`);
  log.log(`File storage · ${await app.get(StorageService).status()}`);
  if (config.runMigrations) await app.get(MigratorService).run();
  await app.get(SeederService).runIfEmpty();
  await app.get(AccessService).loadPermissions();

  const spec = path.resolve("openapi.json");
  if (fs.existsSync(spec)) SwaggerModule.setup("api/docs", app, JSON.parse(fs.readFileSync(spec, "utf8")));

  await app.listen(config.port);
  log.log(`MedxDashboard API ready on http://localhost:${config.port}/api/v1  ·  Swagger UI: http://localhost:${config.port}/api/docs`);
}
await bootstrap();
