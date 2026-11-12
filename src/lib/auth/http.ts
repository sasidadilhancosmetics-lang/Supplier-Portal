import "server-only";

import { NextResponse } from "next/server";

import { isAuthorizationError } from "@/lib/auth/errors";

/**
 * Map authorization failures to HTTP responses without leaking supplier details.
 */
export function authorizationErrorResponse(error: unknown): NextResponse {
  if (!isAuthorizationError(error)) {
    throw error;
  }

  const body =
    error.code === "UNAUTHENTICATED"
      ? { error: "unauthenticated" }
      : error.code === "NOT_FOUND"
        ? { error: "not_found" }
        : { error: "forbidden" };

  return NextResponse.json(body, { status: error.status });
}
