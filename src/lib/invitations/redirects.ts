/**
 * Only same-origin relative return paths are allowed after Auth0 login.
 * Invitation accept URLs must stay under /invite/accept.
 */
export function isSafeInviteReturnTo(returnTo: string | null | undefined): boolean {
  if (!returnTo || typeof returnTo !== "string") {
    return false;
  }
  if (!returnTo.startsWith("/invite/accept")) {
    return false;
  }
  if (returnTo.startsWith("//") || returnTo.includes("://")) {
    return false;
  }
  if (returnTo.includes("\\") || returnTo.includes("\n") || returnTo.includes("\r")) {
    return false;
  }
  return true;
}

export function buildInviteAcceptPath(token: string): string {
  const params = new URLSearchParams({ token });
  return `/invite/accept?${params.toString()}`;
}

export function buildInviteLoginHref(token: string): string {
  const returnTo = buildInviteAcceptPath(token);
  const params = new URLSearchParams({ returnTo });
  return `/auth/login?${params.toString()}`;
}
