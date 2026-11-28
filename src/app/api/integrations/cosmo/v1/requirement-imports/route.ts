import { NextResponse } from "next/server";

import { CosmoIngestError, cosmoErrorResponse } from "@/lib/integrations/cosmo/errors";
import { ingestCosmoOsfRequirementImport } from "@/lib/integrations/cosmo/ingest";

const allowedErrorTypes = new Set([
  "Error", "TypeError", "RangeError", "ReferenceError",
  "PrismaClientKnownRequestError", "PrismaClientUnknownRequestError",
  "PrismaClientValidationError", "PrismaClientInitializationError", "PrismaClientRustPanicError",
]);

/**
 * Cosmo OS → Portal OSF ingest (cosmo-osf-push.v1).
 * Auth: IntegrationCredential Bearer. companyId from credential only.
 * Runs on the default Node.js runtime (`cacheComponents` disallows `runtime` segment config).
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => {
      throw new CosmoIngestError("VALIDATION", "Request body must be JSON.");
    });

    const result = await ingestCosmoOsfRequirementImport({
      authorizationHeader: request.headers.get("authorization"),
      contractVersionHeader: request.headers.get("x-contract-version"),
      idempotencyKeyHeader: request.headers.get("idempotency-key"),
      body,
    });

    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    if (error instanceof CosmoIngestError) {
      return NextResponse.json(cosmoErrorResponse(error), {
        status: error.httpStatus,
      });
    }
    // Messages/stacks can contain credentials, query arguments or inbound data.
    const errorType = error instanceof Error && allowedErrorTypes.has(error.name) ? error.name : "UnknownError";
    const code = error != null && typeof error === "object" && "code" in error &&
      typeof error.code === "string" && /^P\d{4}$/.test(error.code) ? error.code : "UNCLASSIFIED";
    console.error("cosmo osf ingest failed", { errorType, code });
    return NextResponse.json(
      cosmoErrorResponse(
        new CosmoIngestError(
          "TEMPORARY_UNAVAILABLE",
          "Unexpected ingest failure.",
          { retryable: true },
        ),
      ),
      { status: 503 },
    );
  }
}
