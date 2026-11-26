import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { OutboundIntegrationError } from "./errors";
import type { OutboundProvider } from "./schema";

type ConnectionIdentity = {
  id: string;
  companyId: string;
  provider: OutboundProvider;
  origin: string;
};

type Credentials = { identifier: string; secret: string };

type EncryptedCredentials = {
  credentialCiphertext: Uint8Array;
  credentialNonce: Uint8Array;
  credentialTag: Uint8Array;
  credentialKeyId: string;
};

function readKeyring() {
  const activeId = process.env.PORTAL_OUTBOUND_ACTIVE_KEY_ID;
  const keys = new Map<string, Buffer>();
  try {
    const configured: unknown = JSON.parse(process.env.PORTAL_OUTBOUND_KEYRING_JSON ?? "null");
    if (!configured || typeof configured !== "object" || Array.isArray(configured)) throw new Error();
    for (const [id, encoded] of Object.entries(configured)) {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || typeof encoded !== "string") throw new Error();
      const key = Buffer.from(encoded, "base64");
      if (key.length !== 32 || key.toString("base64") !== encoded) throw new Error();
      keys.set(id, key);
    }
    const activeKey = activeId ? keys.get(activeId) : undefined;
    if (!activeId || !activeKey) throw new Error();
    return { activeId, activeKey, keys };
  } catch {
    throw new OutboundIntegrationError("KEYRING_UNAVAILABLE");
  }
}

function associatedData(identity: ConnectionIdentity, keyId: string) {
  return Buffer.from(JSON.stringify([
    "portal-outbound-credentials-v1",
    keyId,
    identity.companyId,
    identity.id,
    identity.provider,
    identity.origin,
  ]));
}

export function encryptCredentials(identity: ConnectionIdentity, credentials: Credentials) {
  const { activeId, activeKey } = readKeyring();
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", activeKey, nonce, { authTagLength: 16 });
  cipher.setAAD(associatedData(identity, activeId));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(credentials), "utf8"),
    cipher.final(),
  ]);
  return {
    credentialCiphertext: ciphertext,
    credentialNonce: nonce,
    credentialTag: cipher.getAuthTag(),
    credentialKeyId: activeId,
    credentialRotatedAt: new Date(),
  };
}

/** Opens an authorized bundle for key rotation or integrity verification. */
export function decryptCredentials(
  identity: ConnectionIdentity,
  bundle: EncryptedCredentials,
): Credentials {
  const key = readKeyring().keys.get(bundle.credentialKeyId);
  if (!key) throw new OutboundIntegrationError("KEYRING_UNAVAILABLE");

  try {
    if (bundle.credentialNonce.length !== 12 || bundle.credentialTag.length !== 16) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", key, bundle.credentialNonce, { authTagLength: 16 });
    decipher.setAAD(associatedData(identity, bundle.credentialKeyId));
    decipher.setAuthTag(bundle.credentialTag);
    const value: unknown = JSON.parse(Buffer.concat([
      decipher.update(bundle.credentialCiphertext),
      decipher.final(),
    ]).toString("utf8"));
    if (
      !value || typeof value !== "object" ||
      !("identifier" in value) || typeof value.identifier !== "string" ||
      !("secret" in value) || typeof value.secret !== "string"
    ) throw new Error();
    return { identifier: value.identifier, secret: value.secret };
  } catch {
    throw new OutboundIntegrationError("INVALID_CREDENTIAL_BUNDLE");
  }
}
