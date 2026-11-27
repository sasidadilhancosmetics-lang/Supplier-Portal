import "server-only";

import { getAuth0Session } from "@/lib/auth/auth0-session";
import { prisma } from "@/lib/db";
import { reportAuthDiagnostic } from "./diagnostics";

import type { AuthState, ProvisionedAppUser } from "./types";

const AUTH0_PROVIDER = "auth0";

function toAppUser(user: {
  id: string;
  email: string;
  name: string | null;
  role: ProvisionedAppUser["role"];
  companyId: string;
  supplierId: string | null;
  isActive: boolean;
}): ProvisionedAppUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    companyId: user.companyId,
    supplierId: user.supplierId,
    isActive: user.isActive,
  };
}

/**
 * Resolve Auth0 session → internal User via ExternalIdentity only.
 * Does not create users, assign roles, or link by email.
 *
 * Auth0 session reads are request-bound (cookie + expiry uses wall-clock time).
 * With Cache Components, getAuth0Session() defers past the static shell.
 * Callers in shared layouts must wrap this behind <Suspense>.
 */
export async function getAuthState(): Promise<AuthState> {
  // Session-read failures are operational errors, not proof of logout. Keep
  // Next.js request/prerender control flow outside an anonymous fallback too.
  const session = await getAuth0Session();

  if (!session?.user?.sub) {
    return { status: "anonymous" };
  }

  const pending = (): AuthState => ({
    status: "pending",
    displayEmail:
      typeof session.user.email === "string" ? session.user.email : null,
    displayName:
      typeof session.user.name === "string" ? session.user.name : null,
  });

  // ID token claims are merged into session.user by the Auth0 SDK.
  const issuerFromToken =
    typeof session.user.iss === "string" ? session.user.iss : null;
  const issuerFromEnv = process.env.AUTH0_DOMAIN
    ? `https://${process.env.AUTH0_DOMAIN.replace(/\/$/, "")}/`
    : null;
  const issuer = issuerFromToken ?? issuerFromEnv;

  if (!issuer) {
    reportAuthDiagnostic("application_issuer_missing");
    return pending();
  }

  let identity;
  try {
    identity = await prisma.externalIdentity.findUnique({
      where: {
        provider_providerIssuer_providerSubject: {
          provider: AUTH0_PROVIDER,
          providerIssuer: issuer,
          providerSubject: session.user.sub,
        },
      },
      include: {
        user: true,
      },
    });
  } catch {
    // Table missing or DB unavailable — never invent a provisioned user.
    reportAuthDiagnostic("application_user_lookup_failed");
    return pending();
  }

  if (!identity || !identity.user.isActive) {
    reportAuthDiagnostic("application_user_missing_or_inactive");
    return pending();
  }

  // Touch last login timestamps (best-effort; ignore failures).
  const now = new Date();
  void prisma.externalIdentity
    .update({
      where: { id: identity.id },
      data: { lastLoginAt: now },
    })
    .catch(() => undefined);
  void prisma.user
    .update({
      where: { id: identity.userId },
      data: { lastLoginAt: now },
    })
    .catch(() => undefined);

  return {
    status: "provisioned",
    user: toAppUser(identity.user),
  };
}
