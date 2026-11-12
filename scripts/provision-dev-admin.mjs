/**
 * One-time DEVELOPMENT-ONLY admin provisioning.
 * Reads Auth0 claims from a gitignored JSON file (never hardcode PII in source).
 *
 * Usage:
 *   node scripts/provision-dev-admin.mjs --claims .local/dev-admin-claims.json --dry-run
 *   node scripts/provision-dev-admin.mjs --claims .local/dev-admin-claims.json --apply
 *
 * Claims file shape (from Auth0 session /auth/profile + iss):
 *   { "sub": "...", "iss": "https://..../", "email": "...", "name": "..." }
 *
 * Idempotent within a transaction. Never links an existing User by email alone.
 */
import { config } from "dotenv";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import ws from "ws";

config({ path: ".env.local" });
neonConfig.webSocketConstructor = ws;

/** Cuid-like id without adding a dependency (dev script only). */
function createId() {
  return `c${Date.now().toString(36)}${randomBytes(8).toString("hex")}`;
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const apply = args.includes("--apply");
const claimsIdx = args.indexOf("--claims");
const claimsPath = claimsIdx >= 0 ? args[claimsIdx + 1] : null;

if (!claimsPath || (!dryRun && !apply) || (dryRun && apply)) {
  console.error(
    "Usage: node scripts/provision-dev-admin.mjs --claims <gitignored.json> (--dry-run | --apply)",
  );
  process.exit(1);
}

const endpoint = (process.env.DATABASE_URL || "").match(/@([^/?]+)/)?.[1] ?? "";
const expectedDev = "ep-little-credit-b35km102";
if (!endpoint.includes(expectedDev)) {
  console.error(
    `Refusing to run: DATABASE_URL endpoint "${endpoint}" is not the development branch host.`,
  );
  process.exit(1);
}

const claims = JSON.parse(fs.readFileSync(path.resolve(claimsPath), "utf8"));
const sub = typeof claims.sub === "string" ? claims.sub : null;
const iss = typeof claims.iss === "string" ? claims.iss : null;
const email = typeof claims.email === "string" ? claims.email : null;
const name = typeof claims.name === "string" ? claims.name : null;

if (!sub || !iss || !email) {
  console.error("Claims file must include sub, iss, and email.");
  process.exit(1);
}

const issuer = iss.endsWith("/") ? iss : `${iss}/`;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function q(client, sql, params = []) {
  return (await client.query(sql, params)).rows;
}

function redactEmail(value) {
  if (!value?.includes("@")) return "(none)";
  return `***@${value.split("@")[1]}`;
}

function redactSub(value) {
  return value.length <= 16 ? `${value.slice(0, 8)}…` : `${value.slice(0, 16)}…`;
}

const client = await pool.connect();
try {
  const companies = await q(
    client,
    `SELECT id, name FROM "Company" ORDER BY "createdAt" ASC`,
  );
  const identity = (
    await q(
      client,
      `SELECT id, "userId", provider, "providerIssuer", "providerSubject"
       FROM "ExternalIdentity"
       WHERE provider = $1 AND "providerIssuer" = $2 AND "providerSubject" = $3`,
      ["auth0", issuer, sub],
    )
  )[0];

  let existingUser = null;
  if (identity) {
    existingUser = (
      await q(
        client,
        `SELECT id, role, email, "companyId", "supplierId", "isActive" FROM "User" WHERE id = $1`,
        [identity.userId],
      )
    )[0];
  }

  const plan = {
    target: {
      project: "holy-art-38015209",
      branch: "development",
      endpoint,
    },
    identity: {
      provider: "auth0",
      providerIssuer: issuer,
      providerSubject: redactSub(sub),
      email: redactEmail(email),
      hasName: Boolean(name),
    },
    actions: [],
  };

  let companyId = companies[0]?.id ?? null;
  if (!companyId) {
    plan.actions.push({
      op: "create_company",
      name: "Purchasing Company (development)",
    });
  } else {
    plan.actions.push({
      op: "reuse_company",
      id: companyId,
      name: companies[0].name,
    });
  }

  if (identity && existingUser) {
    plan.actions.push({
      op: "reuse_external_identity",
      identityId: identity.id,
      userId: existingUser.id,
      currentRole: existingUser.role,
    });
    if (
      existingUser.role !== "ADMIN" ||
      !existingUser.isActive ||
      existingUser.supplierId
    ) {
      plan.actions.push({
        op: "update_user_to_admin",
        userId: existingUser.id,
        set: { role: "ADMIN", isActive: true, supplierId: null },
      });
    } else {
      plan.actions.push({
        op: "noop_user_already_admin",
        userId: existingUser.id,
      });
    }
  } else if (identity && !existingUser) {
    throw new Error(
      "ExternalIdentity exists without User — manual repair required.",
    );
  } else {
    plan.actions.push({
      op: "create_user",
      role: "ADMIN",
      supplierId: null,
      email: redactEmail(email),
    });
    plan.actions.push({
      op: "create_external_identity",
      provider: "auth0",
      providerIssuer: issuer,
      providerSubject: redactSub(sub),
    });
  }

  console.log(JSON.stringify({ mode: dryRun ? "dry-run" : "apply", plan }, null, 2));

  if (dryRun) {
    process.exitCode = 0;
  } else {
    await client.query("BEGIN");
    try {
      if (!companyId) {
        companyId = createId();
        const now = new Date();
        await client.query(
          `INSERT INTO "Company" (id, name, "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $3)`,
          [companyId, "Purchasing Company (development)", now],
        );
      }

      let userId = existingUser?.id ?? null;
      if (identity && existingUser) {
        if (
          existingUser.role !== "ADMIN" ||
          !existingUser.isActive ||
          existingUser.supplierId
        ) {
          await client.query(
            `UPDATE "User"
             SET role = 'ADMIN', "isActive" = true, "supplierId" = NULL, "updatedAt" = $2
             WHERE id = $1`,
            [userId, new Date()],
          );
        }
      } else {
        userId = createId();
        const now = new Date();
        await client.query(
          `INSERT INTO "User" (
             id, "companyId", "supplierId", role, email, name,
             "passwordHash", "isActive", "lastLoginAt", "createdAt", "updatedAt"
           ) VALUES ($1,$2,NULL,'ADMIN',$3,$4,NULL,true,NULL,$5,$5)`,
          [userId, companyId, email, name, now],
        );
        const identityId = createId();
        await client.query(
          `INSERT INTO "ExternalIdentity" (
             id, "userId", provider, "providerIssuer", "providerSubject",
             "createdAt", "updatedAt", "lastLoginAt"
           ) VALUES ($1,$2,'auth0',$3,$4,$5,$5,NULL)`,
          [identityId, userId, issuer, sub, now],
        );
      }

      await client.query("COMMIT");

      const verify = (
        await q(
          client,
          `SELECT u.id, u.role, u."supplierId", u."isActive", e."providerIssuer", e."providerSubject"
           FROM "ExternalIdentity" e
           JOIN "User" u ON u.id = e."userId"
           WHERE e.provider = 'auth0' AND e."providerIssuer" = $1 AND e."providerSubject" = $2`,
          [issuer, sub],
        )
      )[0];

      console.log(
        JSON.stringify(
          {
            applied: true,
            verified: {
              userId: verify?.id,
              role: verify?.role,
              supplierId: verify?.supplierId,
              isActive: verify?.isActive,
              providerIssuer: verify?.providerIssuer,
              providerSubject: redactSub(verify?.providerSubject ?? ""),
            },
          },
          null,
          2,
        ),
      );
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  }
} finally {
  client.release();
  await pool.end();
}
