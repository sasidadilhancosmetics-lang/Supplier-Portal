/**
 * Normalize Auth0 issuer for ExternalIdentity.providerIssuer.
 * Prefer the session/token `iss` claim; fall back to AUTH0_DOMAIN.
 */
export function resolveAuth0Issuer(
  sessionUser: Record<string, unknown>,
): string | null {
  const iss = sessionUser.iss;
  if (typeof iss === "string" && iss.length > 0) {
    return iss.endsWith("/") ? iss : `${iss}/`;
  }
  if (!process.env.AUTH0_DOMAIN) {
    return null;
  }
  return `https://${process.env.AUTH0_DOMAIN.replace(/\/$/, "")}/`;
}
