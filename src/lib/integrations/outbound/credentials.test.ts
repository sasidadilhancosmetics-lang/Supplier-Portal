import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { decryptCredentials, encryptCredentials } from "./credentials";
import { canonicalOrigin, requireApprovedOrigin } from "./schema";

const identity = { id: "test-connection", companyId: "company-a", provider: "ERP_NEXT", origin: "https://erp.example.test" } as const;
const credentials = { identifier: "synthetic-identifier", secret: "synthetic-secret" };

describe("outbound credential encryption", () => {
  const first = randomBytes(32).toString("base64");
  const second = randomBytes(32).toString("base64");

  beforeEach(() => {
    vi.stubEnv("PORTAL_OUTBOUND_KEYRING_JSON", JSON.stringify({ first, second }));
    vi.stubEnv("PORTAL_OUTBOUND_ACTIVE_KEY_ID", "first");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("round-trips synthetic credentials with a fresh nonce and no plaintext in the bundle", () => {
    const bundle = encryptCredentials(identity, credentials);
    expect(decryptCredentials(identity, bundle)).toEqual(credentials);
    expect(bundle.credentialNonce).toHaveLength(12);
    expect(bundle.credentialTag).toHaveLength(16);
    expect(bundle.credentialNonce).not.toEqual(encryptCredentials(identity, credentials).credentialNonce);
    expect(JSON.stringify(bundle)).not.toContain(credentials.secret);
  });

  it.each([
    { companyId: "company-b" },
    { id: "other-connection" },
    { origin: "https://other.example.test" },
    { provider: "SHOPIFY" as const },
  ])("rejects a different binding %o", (changed) => {
    expect(() => decryptCredentials({ ...identity, ...changed }, encryptCredentials(identity, credentials)))
      .toThrow("The stored credential bundle cannot be opened.");
  });

  it("rejects a modified tag or ciphertext", () => {
    const bundle = encryptCredentials(identity, credentials);
    const credentialTag = Buffer.from(bundle.credentialTag);
    credentialTag[0] ^= 1;
    expect(() => decryptCredentials(identity, { ...bundle, credentialTag })).toThrow("cannot be opened");
    const credentialCiphertext = Buffer.from(bundle.credentialCiphertext);
    credentialCiphertext[0] ^= 1;
    expect(() => decryptCredentials(identity, { ...bundle, credentialCiphertext })).toThrow("cannot be opened");
  });

  it("uses the new active key and continues to read an older retained key", () => {
    const old = encryptCredentials(identity, credentials);
    vi.stubEnv("PORTAL_OUTBOUND_ACTIVE_KEY_ID", "second");
    expect(encryptCredentials(identity, credentials).credentialKeyId).toBe("second");
    expect(decryptCredentials(identity, old)).toEqual(credentials);
    vi.stubEnv("PORTAL_OUTBOUND_KEYRING_JSON", JSON.stringify({ second }));
    expect(() => decryptCredentials(identity, old)).toThrow("Credential encryption is not configured");
  });

  it.each([undefined, "{invalid", "null", '{"first":"short"}', "[]"])("fails closed with an invalid keyring %s", (config) => {
    vi.stubEnv("PORTAL_OUTBOUND_KEYRING_JSON", config);
    expect(() => encryptCredentials(identity, credentials)).toThrow("Credential encryption is not configured");
  });

  it("fails closed when the active key is not provisioned", () => {
    vi.stubEnv("PORTAL_OUTBOUND_ACTIVE_KEY_ID", "missing");
    expect(() => encryptCredentials(identity, credentials)).toThrow("Credential encryption is not configured");
  });
});

describe("company origin policy", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("normalizes canonical origins and uses provider and company scope for approvals", () => {
    const origin = canonicalOrigin("ERP_NEXT", "https://ERP.Example.Test/");
    expect(origin).toBe("https://erp.example.test");
    expect(canonicalOrigin("SHOPIFY", "Demo.MyShopify.com")).toBe("https://demo.myshopify.com");
    vi.stubEnv("PORTAL_OUTBOUND_ORIGINS_JSON", JSON.stringify({ "company-a": { ERP_NEXT: [origin] } }));
    expect(() => requireApprovedOrigin("company-a", "ERP_NEXT", origin)).not.toThrow();
    expect(() => requireApprovedOrigin("company-b", "ERP_NEXT", origin)).toThrow("not approved");
    expect(() => requireApprovedOrigin("company-a", "SHOPIFY", origin)).toThrow("not approved");
  });

  it.each([
    "http://erp.example.test", "https://erp.example.test:443", "https://erp.example.test/path",
    "https://erp.example.test?test=1", "https://erp.example.test/#fragment", "https://user@erp.example.test",
    "https://127.0.0.1", "https://[::1]", "https://erp..example.test",
  ])("rejects noncanonical or literal destinations %s", (origin) => {
    expect(() => canonicalOrigin("ERP_NEXT", origin)).toThrow();
  });

  it.each(["shop.example.test", "myshopify.com", "a.b.myshopify.com", "shop.myshopify.com.evil.test"])(
    "rejects invalid Shopify host %s",
    (origin) => expect(() => canonicalOrigin("SHOPIFY", origin)).toThrow(),
  );
});
