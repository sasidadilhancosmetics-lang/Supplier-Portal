import { auth0 } from "@/lib/auth0";
import { NextResponse } from "next/server";

/**
 * Next.js 16 proxy (replaces middleware). Mounts Auth0 /auth/* handlers and
 * session cookies. Role checks stay in server layouts/helpers — not here alone.
 */
export async function proxy(request: Request) {
  const pathname = new URL(request.url).pathname.replace(/\/+$/, "");
  const headers = request.headers;
  // Logout mutates the session. Never let a Link/RSC prefetch execute it.
  // Explicit logout uses a full-document anchor; normal page requests still
  // reach Auth0 unchanged, including their cookies and rolling-session logic.
  if (
    request.method === "GET" && pathname === "/auth/logout" &&
    (headers.has("next-router-prefetch") ||
      headers.has("next-router-segment-prefetch") ||
      headers.get("rsc") === "1" ||
      /prefetch/i.test(headers.get("purpose") ?? "") ||
      /prefetch/i.test(headers.get("sec-purpose") ?? ""))
  ) {
    return new NextResponse(null, {
      status: 204,
      headers: { "Cache-Control": "no-store" },
    });
  }
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
