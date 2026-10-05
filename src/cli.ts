// Database tasks: npm run db:migrate | db:seed | db:reset
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { DbService } from "./database/db.service.js";
import { MigratorService } from "./database/migrator.service.js";
import { SeederService } from "./database/seed/seeder.service.js";

const cmd = process.argv[2];
const app = await NestFactory.createApplicationContext(AppModule, { logger: ["log", "warn", "error"] });
await app.get(DbService).waitUntilReady();
const migrator = app.get(MigratorService), seeder = app.get(SeederService);
if (cmd === "reset") {
  await seeder.reset();
  await migrator.run();
  await seeder.seed();
} else if (cmd === "migrate") {
  await migrator.run();
} else if (cmd === "seed") {
  await migrator.run();
  if (await seeder.isEmpty()) await seeder.seed();
  else console.log("Database already has data. Use `npm run db:reset` to wipe and reseed.");
} else {
  console.log("Usage: node dist/cli.js <migrate|seed|reset>");
}
await app.close();
process.exit(0);
