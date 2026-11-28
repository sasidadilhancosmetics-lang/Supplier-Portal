import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { ingest } = vi.hoisted(() => ({ ingest: vi.fn() }));
vi.mock("@/lib/integrations/cosmo/ingest", () => ({ ingestCosmoOsfRequirementImport: ingest }));

import { CosmoIngestError } from "@/lib/integrations/cosmo/errors";
import { parseCosmoOsfPushPayload } from "@/lib/integrations/cosmo/schema";
import { POST } from "./route";

const payload = JSON.parse(readFileSync(path.join(process.cwd(), "docs/fixtures/osf-product-import.example.json"), "utf8"));
const success = {
  contractVersion: payload.contractVersion, importId: "fixture-import", status: "READY_TO_CONFIRM",
  idempotencyKey: payload.idempotencyKey, replay: false,
  summary: { brandCount: 1, lineCount: 2, matchedCount: 2, unresolvedCount: 0, rejectedCount: 0, totalQuantityProposed: 5 },
  requirements: [{ requirementId: "fixture-draft", brandId: "fixture-brand", brandName: "OSF UAT Synthetic Brand", status: "DRAFT", itemCount: 2 }],
  deepLinkPath: "/staff/osf-imports/fixture-import",
};

function request(body: unknown = payload) {
  return new Request("https://portal.example.invalid/api/integrations/cosmo/v1/requirement-imports", {
    method: "POST", headers: { authorization: "Bearer synthetic-fixture-token", "content-type": "application/json",
      "x-contract-version": payload.contractVersion, "idempotency-key": payload.idempotencyKey },
    body: JSON.stringify(body),
  });
}

describe("OSF product import HTTP contract", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    ingest.mockResolvedValue({ status: 201, body: success });
  });
  afterEach(() => vi.restoreAllMocks());

  it("validates the bounded two-product fixture and forwards authenticated contract headers", async () => {
    expect(parseCosmoOsfPushPayload(payload).items).toHaveLength(2);
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(success);
    expect(ingest).toHaveBeenCalledExactlyOnceWith({ authorizationHeader: "Bearer synthetic-fixture-token",
      contractVersionHeader: payload.contractVersion, idempotencyKeyHeader: payload.idempotencyKey, body: payload });
    expect(console.error).not.toHaveBeenCalled();
  });

  it("returns the existing import/Draft IDs on an identical replay", async () => {
    const first = await (await POST(request())).json();
    ingest.mockResolvedValue({ status: 200, body: { ...success, replay: true } });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ...first, replay: true });
  });

  it("rejects malformed JSON without invoking ingest", async () => {
    const response = await POST(new Request("https://portal.example.invalid/api/integrations/cosmo/v1/requirement-imports", { method: "POST", body: "{" }));
    expect(response.status).toBe(422);
    expect(ingest).not.toHaveBeenCalled();
  });

  it.each([
    ["UNAUTHORIZED", 401], ["COMPANY_MISMATCH", 409], ["IDEMPOTENCY_CONFLICT", 409], ["VALIDATION", 422],
  ] as const)("preserves %s rejection from the authenticated ingest service", async (code, status) => {
    ingest.mockRejectedValue(new CosmoIngestError(code, "Synthetic rejection"));
    const response = await POST(request());
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ error: { code } });
    expect(console.error).not.toHaveBeenCalled();
  });

  it("returns retryable 503 while excluding private exception contents from logs and HTTP responses", async () => {
    ingest.mockRejectedValue(new Error("postgresql://private:secret@database.invalid/db Bearer private-token person@example.invalid"));
    const response = await POST(request());
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({ error: { code: "TEMPORARY_UNAVAILABLE", retryable: true } });
    expect(console.error).toHaveBeenCalledExactlyOnceWith("cosmo osf ingest failed", { errorType: "Error", code: "UNCLASSIFIED" });
    expect(JSON.stringify([body, vi.mocked(console.error).mock.calls])).not.toMatch(/private|secret|person@|postgresql|Bearer/);
  });

  it("reports only an allowlisted Prisma error type and code", async () => {
    ingest.mockRejectedValue(Object.assign(new Error("private query arguments"), { name: "PrismaClientKnownRequestError", code: "P2028" }));
    await POST(request());
    expect(console.error).toHaveBeenCalledExactlyOnceWith("cosmo osf ingest failed", { errorType: "PrismaClientKnownRequestError", code: "P2028" });
  });

  it("does not emit arbitrary exception names or codes", async () => {
    ingest.mockRejectedValue(Object.assign(new Error("private"), { name: "private-identity", code: "private-secret" }));
    await POST(request());
    expect(console.error).toHaveBeenCalledExactlyOnceWith("cosmo osf ingest failed", { errorType: "UnknownError", code: "UNCLASSIFIED" });
  });
});
