import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { db, getAuthState, writeAuditLog, revalidatePath, redirect } = vi.hoisted(() => ({
  db: {
    outboundIntegrationConnection: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    integrationCredential: { findMany: vi.fn() },
    auditLog: { findMany: vi.fn(), findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
  getAuthState: vi.fn(),
  writeAuditLog: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/auth/session", () => ({ getAuthState }));
vi.mock("@/lib/audit", () => ({ writeAuditLog }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect }));

import {
  createIntegrationAction,
  renameIntegrationAction,
  replaceIntegrationCredentialsAction,
  setIntegrationEnabledAction,
  testIntegrationAction,
} from "@/app/admin/settings/integrations/actions";
import { AuthorizationError } from "@/lib/auth/errors";

import { createAdminIntegration, getAdminIntegration, listAdminIntegrations, testAdminIntegration, updateAdminIntegration } from "./admin";

const connection = {
  id: "connection-a",
  provider: "SHOPIFY",
  origin: "https://shop.myshopify.com",
  label: "Synthetic Shop",
  enabled: false,
  configVersion: 7,
  credentialRotatedAt: new Date(0),
};
const request = { id: connection.id, expectedVersion: 7 };
const key = randomBytes(32).toString("base64");
const actor = { id: "admin-a", companyId: "company-a", role: "ADMIN", isActive: true };
const companyAudit = { entityType: "OutboundIntegrationConnection", afterJson: { path: ["companyId"], equals: "company-a" } };

beforeEach(() => {
  vi.resetAllMocks();
  getAuthState.mockResolvedValue({ status: "provisioned", user: actor });
  db.outboundIntegrationConnection.findFirst.mockResolvedValue(connection);
  db.$transaction.mockImplementation(async (work: (tx: typeof db) => Promise<unknown>) => work(db));
  vi.stubEnv("PORTAL_OUTBOUND_ORIGINS_JSON", JSON.stringify({
    "company-a": { SHOPIFY: [connection.origin], ERP_NEXT: ["https://erp1.example.test", "https://erp2.example.test"] },
  }));
  vi.stubEnv("PORTAL_OUTBOUND_ACTIVE_KEY_ID", "fixture");
  vi.stubEnv("PORTAL_OUTBOUND_KEYRING_JSON", JSON.stringify({ fixture: key }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("admin access and data scope", () => {
  it.each([
    ["staff", { ...actor, role: "STAFF" }],
    ["supplier", { ...actor, role: "SUPPLIER" }],
    ["inactive admin", { ...actor, isActive: false }],
  ])("rejects %s at service entry before touching the database", async (_label, caller) => {
    getAuthState.mockResolvedValue({ status: "provisioned", user: caller });
    for (const invoke of [
      listAdminIntegrations,
      () => getAdminIntegration(connection.id),
      () => createAdminIntegration({}),
      () => updateAdminIntegration({}),
      () => testAdminIntegration({}),
    ]) {
      await expect(invoke()).rejects.toBeInstanceOf(AuthorizationError);
    }
    expect(db.outboundIntegrationConnection.findFirst).not.toHaveBeenCalled();
    expect(db.outboundIntegrationConnection.findMany).not.toHaveBeenCalled();
    expect(db.integrationCredential.findMany).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("guards all direct Server Actions without exposing values or revalidating", async () => {
    getAuthState.mockResolvedValue({ status: "anonymous" });
    const form = new FormData();
    form.set("secret", "synthetic-marker");
    for (const action of [createIntegrationAction, renameIntegrationAction, setIntegrationEnabledAction, replaceIntegrationCredentialsAction, testIntegrationAction]) {
      await expect(action(undefined, form)).resolves.toEqual({ ok: false, message: "You do not have permission to do that." });
    }
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("checks connection ownership before history, test, and mutation", async () => {
    db.outboundIntegrationConnection.findFirst.mockResolvedValue(null);
    await expect(getAdminIntegration("other")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(testAdminIntegration({ ...request, id: "other" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(updateAdminIntegration({ ...request, id: "other", kind: "rename", label: "Other" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    for (const [query] of db.outboundIntegrationConnection.findFirst.mock.calls) {
      expect(query.where).toEqual({ id: "other", companyId: "company-a" });
    }
    expect(db.auditLog.findMany).not.toHaveBeenCalled();
    expect(db.auditLog.findFirst).not.toHaveBeenCalled();
    expect(db.outboundIntegrationConnection.updateMany).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("uses explicit, company-scoped listing projections", async () => {
    const createdAt = new Date(0);
    db.outboundIntegrationConnection.findMany.mockResolvedValue([connection]);
    db.integrationCredential.findMany.mockResolvedValue([]);
    db.auditLog.findMany.mockResolvedValue([{
      entityId: connection.id, createdAt,
      afterJson: { configVersion: 6, result: "MOCK_PASSED", unexpected: "synthetic-marker" },
    }]);
    const list = await listAdminIntegrations();
    expect(list).toEqual({
      connections: [{ ...connection, lastMock: { configVersion: 6, result: "MOCK_PASSED", createdAt } }],
      cosmo: [],
    });
    expect(JSON.stringify(list)).not.toContain("synthetic-marker");
    for (const delegate of [db.outboundIntegrationConnection, db.integrationCredential]) {
      const query = delegate.findMany.mock.calls[0][0];
      expect(query.where).toEqual({ companyId: "company-a" });
      expect(JSON.stringify(query.select)).not.toMatch(/ciphertext|nonce|tag|credentialKeyId|tokenHash|tokenPrefix/i);
    }
    expect(db.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { ...companyAudit, entityId: { in: [connection.id] }, action: "INTEGRATION_MOCK_TESTED" },
      distinct: ["entityId"],
    }));
  });

  it("pages scoped audit projections and discards arbitrary event data", async () => {
    const createdAt = new Date(0);
    db.auditLog.findMany.mockResolvedValue(Array.from({ length: 26 }, (_, i) => ({
      id: String(i), action: "INTEGRATION_MOCK_TESTED", createdAt, unexpected: "synthetic-marker",
    })));
    db.auditLog.findFirst.mockResolvedValue({ afterJson: { configVersion: 8, result: "AUTH_REJECTED", secret: "synthetic-marker" }, createdAt });
    const result = await getAdminIntegration(connection.id, "2");
    expect(db.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { ...companyAudit, entityId: connection.id, action: { in: expect.arrayContaining(["INTEGRATION_MOCK_TESTED"]) } },
      skip: 25,
      take: 26,
    }));
    expect(db.auditLog.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { ...companyAudit, entityId: connection.id, action: "INTEGRATION_MOCK_TESTED" },
    }));
    expect(result.history).toHaveLength(25);
    expect(result.history[0]).toEqual({ id: "0", label: "Mock connection test", createdAt });
    expect(result).toMatchObject({ historyPage: 2, hasMoreHistory: true });
    expect(result.lastMock).toEqual({ configVersion: 8, result: "AUTH_REJECTED", createdAt });
    expect(JSON.stringify(result)).not.toContain("synthetic-marker");
  });
});

describe("guarded writes and mock checks", () => {
  it("creates in the session company and rejects a spoofed identity", async () => {
    const input = { provider: "SHOPIFY", label: "New shop", origin: "shop.myshopify.com" };
    await expect(createAdminIntegration({ ...input, companyId: "company-b" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    db.outboundIntegrationConnection.create.mockResolvedValue({ id: "new", configVersion: 1 });
    await expect(createAdminIntegration(input)).resolves.toEqual({ id: "new" });
    expect(db.outboundIntegrationConnection.create.mock.calls[0][0].data).toEqual({
      companyId: "company-a", provider: "SHOPIFY", label: "New shop", origin: connection.origin,
    });
    expect(writeAuditLog.mock.calls[0][0]).toMatchObject({ actorUserId: "admin-a", tx: db });
  });

  it("creates multiple approved ERP origins and starts Shopify disabled", async () => {
    db.outboundIntegrationConnection.create.mockResolvedValue({ id: "fixture", configVersion: 1 });
    for (const origin of ["https://erp1.example.test", "https://erp2.example.test"]) {
      await createAdminIntegration({ provider: "ERP_NEXT", label: "ERP fixture", origin });
    }
    await createAdminIntegration({ provider: "SHOPIFY", label: "Shop fixture", origin: connection.origin });
    expect(db.outboundIntegrationConnection.create.mock.calls.map(([call]) => call.data.origin)).toEqual([
      "https://erp1.example.test", "https://erp2.example.test", connection.origin,
    ]);
    expect(db.outboundIntegrationConnection.create.mock.lastCall?.[0].data.enabled).toBeUndefined();
  });

  it.each(["companyId", "provider", "origin"])("rejects attempts to change immutable %s", async (field) => {
    await expect(updateAdminIntegration({ ...request, kind: "rename", label: "New label", [field]: "changed" }))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("propagates an audit failure through the write transaction", async () => {
    const failedAudit = new Error("Synthetic audit failure");
    const committed = vi.fn();
    db.$transaction.mockImplementation(async (work: (tx: typeof db) => Promise<unknown>) => {
      const result = await work(db);
      committed();
      return result;
    });
    db.outboundIntegrationConnection.updateMany.mockResolvedValue({ count: 1 });
    writeAuditLog.mockRejectedValue(failedAudit);
    await expect(updateAdminIntegration({ ...request, kind: "rename", label: "New label" })).rejects.toBe(failedAudit);
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ tx: db }));
    expect(committed).not.toHaveBeenCalled();
  });

  it("permits only one of two concurrent same-version edits and audits only that edit", async () => {
    let latest = connection.configVersion;
    db.outboundIntegrationConnection.updateMany.mockImplementation(async ({ where }) => {
      if (where.configVersion !== latest) return { count: 0 };
      latest++;
      return { count: 1 };
    });
    const results = await Promise.allSettled(
      ["First", "Second"].map((label) => updateAdminIntegration({ ...request, kind: "rename", label })),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({ reason: { code: "STALE_VERSION" } });
    expect(writeAuditLog).toHaveBeenCalledTimes(1);
    for (const [query] of db.outboundIntegrationConnection.updateMany.mock.calls) {
      expect(query.where).toEqual({ id: connection.id, companyId: "company-a", configVersion: 7 });
      expect(Object.keys(query.data).sort()).toEqual(["configVersion", "label"]);
    }
  });

  it("translates Shopify enable and duplicate-origin uniqueness failures", async () => {
    db.outboundIntegrationConnection.updateMany.mockRejectedValue({ code: "P2002" });
    await expect(updateAdminIntegration({ ...request, kind: "enabled", enabled: true }))
      .rejects.toMatchObject({ code: "SHOPIFY_ALREADY_ENABLED" });
    db.outboundIntegrationConnection.create.mockRejectedValue({ code: "P2002" });
    await expect(createAdminIntegration({ provider: "SHOPIFY", label: "Shop", origin: connection.origin }))
      .rejects.toMatchObject({ code: "DUPLICATE_ORIGIN" });
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("encrypts only the replacement and does not return or audit submitted secrets or stored bytes", async () => {
    const form = new FormData();
    form.set("id", request.id);
    form.set("expectedVersion", String(request.expectedVersion));
    form.set("identifier", "synthetic-identifier");
    form.set("secret", "synthetic-marker");
    db.outboundIntegrationConnection.updateMany.mockResolvedValue({ count: 1 });
    await expect(replaceIntegrationCredentialsAction(undefined, form)).resolves.toEqual({ ok: true, message: "Credentials saved." });
    const { data } = db.outboundIntegrationConnection.updateMany.mock.calls[0][0];
    expect(data.credentialCiphertext).toBeInstanceOf(Uint8Array);
    expect(data.credentialTag).toHaveLength(16);
    expect(data).not.toHaveProperty("secret");
    expect(writeAuditLog.mock.calls[0][0].afterJson).toEqual({ companyId: "company-a", provider: "SHOPIFY", configVersion: 8 });
    expect(JSON.stringify(writeAuditLog.mock.calls[0][0])).not.toContain("synthetic-marker");
  });

  it("fails closed without keys and masks unexpected database errors from action results", async () => {
    const form = new FormData();
    form.set("id", request.id);
    form.set("expectedVersion", String(request.expectedVersion));
    form.set("identifier", "synthetic-identifier");
    form.set("secret", "synthetic-marker");
    vi.stubEnv("PORTAL_OUTBOUND_KEYRING_JSON", undefined);
    await expect(replaceIntegrationCredentialsAction(undefined, form)).resolves.toEqual({ ok: false, message: "Credential encryption is not configured." });
    expect(db.outboundIntegrationConnection.updateMany).not.toHaveBeenCalled();
    vi.stubEnv("PORTAL_OUTBOUND_KEYRING_JSON", JSON.stringify({ fixture: key }));
    db.outboundIntegrationConnection.updateMany.mockRejectedValue(new Error("database error with synthetic-marker"));
    await expect(replaceIntegrationCredentialsAction(undefined, form)).resolves.toEqual({ ok: false, message: "The integration action could not be completed." });
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("runs the mock with no network, keyring, or credential bytes", async () => {
    const network = vi.fn(() => { throw new Error("Unexpected network call"); });
    vi.stubGlobal("fetch", network);
    vi.stubEnv("PORTAL_OUTBOUND_KEYRING_JSON", undefined);
    await expect(testAdminIntegration(request)).resolves.toBe("MOCK_PASSED");
    const { select } = db.outboundIntegrationConnection.findFirst.mock.calls[0][0];
    expect(Object.keys(select).filter((field) => field.startsWith("credential"))).toEqual(["credentialRotatedAt"]);
    expect(writeAuditLog.mock.calls[0][0].afterJson).toEqual({ companyId: "company-a", provider: "SHOPIFY", configVersion: 7, result: "MOCK_PASSED" });
    expect(network).not.toHaveBeenCalled();
    expect(db.outboundIntegrationConnection.updateMany).not.toHaveBeenCalled();
  });
});
