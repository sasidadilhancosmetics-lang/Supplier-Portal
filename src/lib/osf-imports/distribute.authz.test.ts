import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/auth/guards", () => ({
  requireStaffPermission: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    osfImport: { findFirst: vi.fn() },
    osfImportDistribution: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    requirement: { findFirst: vi.fn() },
    supplier: { findMany: vi.fn() },
    supplierRequest: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    user: { findMany: vi.fn() },
    idempotencyKey: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const { prisma } = await import("@/lib/db");
      return fn(prisma);
    }),
    $queryRaw: vi.fn(),
  },
}));

vi.mock("@/lib/audit", () => ({
  writeAuditLog: vi.fn(),
}));

vi.mock("@/lib/notifications", () => ({
  createUserNotification: vi.fn(),
}));

import { AuthorizationError } from "@/lib/auth/errors";
import { requireStaffPermission } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import {
  distributeOsfImport,
  getOsfImportDistributeModel,
  hashDistributeOsfImportRequest,
} from "./distribute";
import { OsfImportDomainError } from "./errors";

const requirePerm = vi.mocked(requireStaffPermission);

const staffUser = {
  id: "usr_staff",
  companyId: "co_1",
  role: "STAFF" as const,
  supplierId: null,
  email: "staff@example.com",
  name: "Staff",
  isActive: true,
};

describe("OSF distribute authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePerm.mockResolvedValue(staffUser);
    vi.mocked(prisma.idempotencyKey.findUnique).mockResolvedValue(null);
  });

  it("requires SEND_SUPPLIER_REQUEST for wizard model", async () => {
    requirePerm.mockRejectedValueOnce(new AuthorizationError("FORBIDDEN"));
    await expect(getOsfImportDistributeModel("imp_1")).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    expect(requirePerm).toHaveBeenCalledWith("SEND_SUPPLIER_REQUEST");
  });

  it("requires SEND_SUPPLIER_REQUEST for distribute", async () => {
    requirePerm.mockRejectedValueOnce(new AuthorizationError("FORBIDDEN"));
    await expect(
      distributeOsfImport({
        importId: "imp_1",
        idempotencyKey: "11111111-1111-4111-8111-111111111111",
        brands: [{ requirementId: "req_1", mode: "ALL_MATCHING", supplierIds: [] }],
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("returns NOT_FOUND for cross-company import", async () => {
    vi.mocked(prisma.osfImport.findFirst).mockResolvedValue(null);
    await expect(
      distributeOsfImport({
        importId: "imp_other",
        idempotencyKey: "11111111-1111-4111-8111-111111111111",
        brands: [{ requirementId: "req_1", mode: "ALL_MATCHING", supplierIds: [] }],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" } satisfies Partial<OsfImportDomainError>);
  });

  it("rejects non-confirmed imports", async () => {
    vi.mocked(prisma.osfImport.findFirst).mockResolvedValue({
      id: "imp_1",
      status: "READY_TO_CONFIRM",
    } as never);
    await expect(
      distributeOsfImport({
        importId: "imp_1",
        idempotencyKey: "11111111-1111-4111-8111-111111111111",
        brands: [{ requirementId: "req_1", mode: "ALL_MATCHING", supplierIds: [] }],
      }),
    ).rejects.toMatchObject({ code: "NOT_READY" });
  });

  it("detects same-key payload mismatch", async () => {
    const key = "11111111-1111-4111-8111-111111111111";
    const inputA = {
      importId: "imp_1",
      idempotencyKey: key,
      responseDeadline: undefined,
      acknowledgeOverQty: false,
      retryFailedOnly: false,
      brands: [
        { requirementId: "req_1", mode: "ALL_MATCHING" as const, supplierIds: [] },
      ],
    };
    const hashA = hashDistributeOsfImportRequest(inputA);
    vi.mocked(prisma.idempotencyKey.findUnique).mockResolvedValue({
      id: "ik_1",
      scope: "osf.import.distribute:usr_staff",
      key,
      expiresAt: new Date(Date.now() + 60_000),
      responseJson: { status: "complete", requestHash: hashA, result: { importId: "imp_1", brands: [], replay: false } },
      createdAt: new Date(),
    } as never);

    await expect(
      distributeOsfImport({
        ...inputA,
        brands: [
          {
            requirementId: "req_1",
            mode: "SELECTED",
            supplierIds: ["sup_1"],
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_PAYLOAD_MISMATCH" });
  });
});
