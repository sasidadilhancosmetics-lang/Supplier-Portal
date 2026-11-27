/**
 * Phase B rehearsal-only Prisma config. Uses the proposed schema and a copy of
 * the migrations folder; datasource is forced to the rehearsal branch.
 */
import path from "node:path";
import { defineConfig } from "prisma/config";

import { applyRehearsalEnv } from "./rehearsal-env";

applyRehearsalEnv();

const here = path.resolve(process.cwd(), "tmp-rehearsal-phase-b");

export default defineConfig({
  schema: path.join(here, "schema.prisma"),
  migrations: {
    path: path.join(here, "migrations"),
  },
  datasource: {
    url: process.env.DATABASE_URL_UNPOOLED!,
  },
});
