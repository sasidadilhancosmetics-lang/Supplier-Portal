import { Auth0Client } from "@auth0/nextjs-auth0/server";

/**
 * Auth0 SDK client (v4). Session and /auth/* routes are handled via src/proxy.ts.
 * Application roles and supplierId are resolved from Postgres, not Auth0 claims.
 */
export const auth0 = new Auth0Client();
