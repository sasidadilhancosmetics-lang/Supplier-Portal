import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";

/**
 * Read-only database health check.
 * Returns ok/degraded only — no connection strings, hostnames, or schema details.
 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, database: "up" });
  } catch {
    return NextResponse.json({ ok: false, database: "down" }, { status: 503 });
  }
}
