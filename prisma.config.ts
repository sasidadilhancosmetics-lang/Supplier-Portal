import { config as loadEnv } from "dotenv";
import { defineConfig, env } from "prisma/config";

// Neon CLI writes secrets to .env.local; also allow plain .env for CI.
loadEnv({ path: ".env.local" });
loadEnv();

/**
 * Prisma ORM 7 CLI config (migrations, generate).
 * Use the direct (unpooled) URL for Migrate. Runtime Prisma Client uses the
 * pooled DATABASE_URL via @prisma/adapter-neon — see src/lib/db.ts.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Neon init provides DATABASE_URL_UNPOOLED; DIRECT_DATABASE_URL is an alias.
    url: process.env.DATABASE_URL_UNPOOLED
      ? env("DATABASE_URL_UNPOOLED")
      : env("DIRECT_DATABASE_URL"),
  },
});
