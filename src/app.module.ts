import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ScheduleModule } from "@nestjs/schedule";
import { DbService } from "./database/db.service.js";
import { MigratorService } from "./database/migrator.service.js";
import { SeederService } from "./database/seed/seeder.service.js";
import { Repo } from "./domain/repository.service.js";
import { AccessService } from "./domain/access.service.js";
import { HooksService } from "./domain/hooks.service.js";
import { WorkflowsService } from "./domain/workflows.service.js";
import { AuthGuard } from "./auth/auth.guard.js";
import { AuthController } from "./auth/auth.controller.js";
import { CoreController } from "./modules/core.controller.js";
import { PeopleController } from "./modules/people.controller.js";
import { TimeController } from "./modules/time.controller.js";
import { PayController } from "./modules/pay.controller.js";
import { ResourcesController } from "./modules/resources.controller.js";
import { DashboardService } from "./modules/dashboard.service.js";
import { JobsService } from "./jobs/jobs.service.js";
import { StorageService } from "./storage/storage.service.js";

@Module({
  imports: [ScheduleModule.forRoot()],
  // Order matters: specific routes first, the generic /:resource controller last
  controllers: [AuthController, CoreController, PeopleController, TimeController, PayController, ResourcesController],
  providers: [DbService, MigratorService, SeederService, Repo, AccessService, HooksService, WorkflowsService, DashboardService, JobsService, StorageService, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
