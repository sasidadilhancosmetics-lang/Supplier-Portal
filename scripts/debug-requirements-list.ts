/**
 * Reproduce listRequirements / listBrandsForRequirements failures (dev only).
 */
import { config } from "dotenv";
import { neonConfig } from "@neondatabase/serverless";
import { PrismaNeon } from "@prisma/adapter-neon";
import ws from "ws";

import { PrismaClient } from "../src/generated/prisma/client";
import { requirementListQuerySchema } from "../src/lib/requirements/schema";

config({ path: ".env.local" });
neonConfig.webSocketConstructor = ws;

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  const admins = await prisma.user.findMany({
    where: { role: "ADMIN", isActive: true },
    select: { id: true, email: true, companyId: true, role: true },
    take: 5,
  });
  console.log("admins", admins);

  const admin = admins[0];
  if (!admin) {
    console.log("No ADMIN user found");
    return;
  }

  const parsed = requirementListQuerySchema.safeParse({});
  console.log("schema", parsed.success, parsed.success ? parsed.data : parsed.error.flatten());

  try {
    const where = { companyId: admin.companyId };
    const [total, rows] = await prisma.$transaction([
      prisma.requirement.count({ where }),
      prisma.requirement.findMany({
        where,
        orderBy: [{ createdAt: "desc" }],
        skip: 0,
        take: 20,
        include: {
          brand: { select: { id: true, name: true } },
          _count: { select: { items: true } },
        },
      }),
    ]);
    console.log(
      JSON.stringify(
        {
          total,
          items: rows.map((r) => ({
            id: r.id,
            title: r.title,
            status: r.status,
            brand: r.brand.name,
            itemCount: r._count.items,
            confirmedAt: r.confirmedAt,
          })),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error("LIST_QUERY_ERROR", error);
  }

  try {
    const brands = await prisma.brand.findMany({
      where: { companyId: admin.companyId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    console.log("brands", brands.length);
  } catch (error) {
    console.error("BRANDS_ERROR", error);
  }

  try {
    const perms = await prisma.staffPermission.findMany({
      where: { userId: admin.id },
      select: { code: true },
    });
    console.log("admin staffPermission rows", perms);
  } catch (error) {
    console.error("PERMS_ERROR", error);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
