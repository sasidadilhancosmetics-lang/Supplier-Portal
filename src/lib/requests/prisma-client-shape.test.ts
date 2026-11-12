import { describe, expect, it } from "vitest";

import { Prisma } from "@/generated/prisma/client";

describe("generated Prisma client Stage 5B shape", () => {
  it("includes SupplierRequest.responseDeadline after migration generate", () => {
    expect(Prisma.SupplierRequestScalarFieldEnum.responseDeadline).toBe(
      "responseDeadline",
    );
  });

  it("includes MANAGE_REQUIREMENTS in StaffPermissionCode", async () => {
    const { StaffPermissionCode } = await import("@/generated/prisma/client");
    expect(StaffPermissionCode.MANAGE_REQUIREMENTS).toBe("MANAGE_REQUIREMENTS");
  });
});
