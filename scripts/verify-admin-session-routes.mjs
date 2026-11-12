/**
 * Dev-only route verification using a temporary encrypted session cookie.
 * Does not print secrets, emails, or full subjects.
 */
import { config } from "dotenv";
import { Pool, neonConfig } from "@neondatabase/serverless";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ws from "ws";

config({ path: ".env.local" });
neonConfig.webSocketConstructor = ws;

const helpers = await import(
  pathToFileURL(
    path.resolve(
      "node_modules/@auth0/nextjs-auth0/dist/test/proxy-handler-test-helpers.js",
    ),
  ).href
);
const { createInitialSessionData, createSessionCookie } = helpers;

const claims = JSON.parse(
  fs.readFileSync(path.resolve(".local/dev-admin-claims.json"), "utf8"),
);
const secret = process.env.AUTH0_SECRET;
const issuer = claims.iss.endsWith("/") ? claims.iss : `${claims.iss}/`;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const mapped = (
    await pool.query(
      `SELECT u.role, u."supplierId", u."isActive"
       FROM "ExternalIdentity" e
       JOIN "User" u ON u.id = e."userId"
       WHERE e.provider = 'auth0'
         AND e."providerIssuer" = $1
         AND e."providerSubject" = $2`,
      [issuer, claims.sub],
    )
  ).rows[0];
  console.log(
    JSON.stringify({
      dbMapping: {
        found: Boolean(mapped),
        role: mapped?.role ?? null,
        supplierId: mapped?.supplierId ?? null,
        isActive: mapped?.isActive ?? null,
      },
    }),
  );
  if (!mapped || mapped.role !== "ADMIN" || !mapped.isActive) process.exit(2);
} finally {
  await pool.end();
}

const cookie = await createSessionCookie(
  createInitialSessionData({
    user: {
      sub: claims.sub,
      iss: issuer,
      email: claims.email,
      name: claims.name,
      email_verified: true,
    },
  }),
  secret,
);

function parse(html) {
  const redirects = [...html.matchAll(/NEXT_REDIRECT;replace;([^;]+);(\d+)/g)].map(
    (m) => ({ to: m[1], code: Number(m[2]) }),
  );
  const provisioned = /"status":"provisioned"/.test(html);
  const pending = /"status":"pending"/.test(html);
  const anonymous = /"status":"anonymous"/.test(html);
  return {
    redirects,
    provisioned,
    pending,
    anonymous,
    hasAdminAudience: /Company Admin/.test(html),
    hasStaffAudience: /Company Staff/.test(html),
    hasSupplierAudience: /For:\s*Supplier/.test(html),
    hasLogOut: /Log out/.test(html),
  };
}

async function probe(pathName, withCookie) {
  const res = await fetch(`http://localhost:3000${pathName}`, {
    redirect: "manual",
    headers: withCookie ? { Cookie: cookie } : {},
  });
  const html = await res.text();
  return {
    path: pathName,
    auth: withCookie ? "session" : "anonymous",
    status: res.status,
    location: res.headers.get("location"),
    ...parse(html),
  };
}

const results = {
  anonymousAdmin: await probe("/admin", false),
  sessionAdmin: await probe("/admin", true),
  sessionStaff: await probe("/staff", true),
  sessionSupplier: await probe("/supplier", true),
  sessionHome: await probe("/", true),
  logout: await probe("/auth/logout", true),
};

console.log(JSON.stringify({ routeChecks: results }, null, 2));
