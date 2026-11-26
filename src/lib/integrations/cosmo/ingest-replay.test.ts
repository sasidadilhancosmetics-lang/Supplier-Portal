import { expect, it, vi } from "vitest";

const { db, touchCredentialLastUsed } = vi.hoisted(() => ({
  db: { osfImport: { findUnique: vi.fn(), findFirst: vi.fn() }, $transaction: vi.fn() },
  touchCredentialLastUsed: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("./credentials", async (importOriginal) => ({
  ...await importOriginal<typeof import("./credentials")>(),
  authenticateIntegrationCredential: async () => ({
    id: "credential-a", companyId: "portal-a", cosmoCompanyId: "cosmo-a",
  }),
  touchCredentialLastUsed,
}));

import { ingestCosmoOsfRequirementImport } from "./ingest";
import { hashOsfPushPayload, parseCosmoOsfPushPayload } from "./schema";

it("replays a committed import and rejects a regenerated sentAt with the same key", async () => {
  const contractVersion = "cosmo-osf-push.v1";
  const idempotencyKey = "mock-import-replay-1";
  const body = {
    contractVersion, idempotencyKey,
    source: { system: "cosmo-os", cosmoCompanyId: "cosmo-a", sentAt: "2026-11-21T00:00:00.000Z" },
    selection: { mode: "SUPPLIER_ORDERS_SELECTION" },
    items: [{
      lineKey: "SKU-1", sku: "SKU-1", description: "Synthetic",
      brand: { cosmoVendorId: "brand-a", name: "Synthetic Brand" },
      quantity: { totalOrderQty: 3 },
    }],
  };
  db.osfImport.findUnique.mockResolvedValue({
    id: "existing-import", payloadHash: hashOsfPushPayload(parseCosmoOsfPushPayload(body)),
  });
  db.osfImport.findFirst.mockResolvedValue({
    id: "existing-import", idempotencyKey, status: "READY_TO_CONFIRM", lines: [], requirements: [],
  });
  const request = { authorizationHeader: "Bearer synthetic", contractVersionHeader: contractVersion,
    idempotencyKeyHeader: idempotencyKey, body };

  await expect(ingestCosmoOsfRequirementImport(request)).resolves.toMatchObject({
    status: 200, body: { importId: "existing-import", replay: true },
  });
  expect(db.osfImport.findFirst).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: "existing-import", companyId: "portal-a" },
  }));
  await expect(ingestCosmoOsfRequirementImport({ ...request, body: {
    ...body, source: { ...body.source, sentAt: "2026-11-21T00:01:00.000Z" },
  } })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  expect(touchCredentialLastUsed).toHaveBeenCalledTimes(1);
  expect(db.$transaction).not.toHaveBeenCalled();
});
