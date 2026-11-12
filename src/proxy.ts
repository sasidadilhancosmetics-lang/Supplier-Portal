import { auth0 } from "@/lib/auth0";

/**
 * Next.js 16 proxy (replaces middleware). Mounts Auth0 /auth/* handlers and
 * session cookies. Role checks stay in server layouts/helpers — not here alone.
 */
export async function proxy(request: Request) {
  return auth0.middleware(request);
}

export const config = {
  matcher: [
    /*
     * Match all paths except Next.js internals and static assets.
     */
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
