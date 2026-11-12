import { config } from "dotenv";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma/client.ts";

config({ path: ".env.local" });

if (process.env.NEON_BRANCH !== "development") {
  console.log(`STOP_BRANCH=${process.env.NEON_BRANCH}`);
  process.exit(2);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.log("STOP_NO_DATABASE_URL");
  process.exit(2);
}

const host = connectionString.match(/@([^/?]+)/)?.[1] ?? "unknown";
if (host.includes("fancy-voice")) {
  console.log("STOP_PROD_HOST");
  process.exit(3);
}

const adapter = new PrismaNeon({ connectionString });
const prisma = new PrismaClient({ adapter });

try {
  await prisma.$queryRaw`SELECT 1`;
  console.log(`HEALTH_OK host=${host} branch=${process.env.NEON_BRANCH}`);
  process.exitCode = 0;
} catch (error) {
  console.log("HEALTH_DOWN");
  console.log(String(error?.message ?? error));
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
