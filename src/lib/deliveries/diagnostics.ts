const allowedErrorTypes = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "ReferenceError",
  "PrismaClientKnownRequestError",
  "PrismaClientUnknownRequestError",
  "PrismaClientValidationError",
  "PrismaClientInitializationError",
  "PrismaClientRustPanicError",
]);

/** Never log error messages, stacks, query parameters, form values or identities. */
export function reportReceiptFailure(
  error: unknown,
  phase: "verify" | "revalidate_after_commit",
): void {
  const errorType = error instanceof Error && allowedErrorTypes.has(error.name)
    ? error.name
    : "UnknownError";
  const code = error != null && typeof error === "object" && "code" in error &&
    typeof error.code === "string" && /^P\d{4}$/.test(error.code)
    ? error.code
    : "UNCLASSIFIED";

  console.error("[receipt] unexpected_failure", { phase, errorType, code });
}
