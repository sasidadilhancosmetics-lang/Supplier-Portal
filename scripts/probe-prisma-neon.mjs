import { config } from "dotenv";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { pathToFileURL } from "node:url";
import path from "node:path";

config({ path: ".env.local" });
neonConfig.webSocketConstructor = ws;

const branch = process.env.NEON_BRANCH;
const connectionString = process.env.DATABASE_URL;
const host = connectionString?.match(/@([^/?]+)/)?.[1] ?? "unknown";

console.log(`branch=${branch}`);
console.log(`pooledHost=${host}`);

if (branch !== "development") {
  console.log("STOP_NOT_DEVELOPMENT");
  process.exit(2);
}

const clientPath = pathToFileURL(
  path.join(process.cwd(), "src/generated/prisma/client.ts"),
).href;

const { PrismaClient } = await import(clientPath);
const adapter = new PrismaNeon({ connectionString });
const prisma = new PrismaClient({ adapter });

try {
  await prisma.$queryRaw`SELECT 1 AS ok`;
  console.log("PRISMA_NEON_OK");
} catch (error) {
  console.log("PRISMA_NEON_FAIL");
  console.log(`name=${error?.name ?? "unknown"}`);
  console.log(`code=${error?.code ?? "none"}`);
  console.log(`message=${String(error?.message ?? error).slice(0, 300)}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect().catch(() => undefined);
}
