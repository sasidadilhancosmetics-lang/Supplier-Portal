"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { isAuthorizationError } from "@/lib/auth/errors";
import {
  isRequestDomainError,
  requestErrorMessage,
} from "@/lib/requests/errors";
import { distributeRequirement } from "@/lib/requests/distribute";

export type ActionResult =
  | { ok: true; count?: number }
  | { ok: false; error: string };

function isNextRedirectError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    String((error as { digest?: string }).digest).startsWith("NEXT_REDIRECT")
  );
}

export async function distributeRequirementAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const mode = String(formData.get("mode") ?? "ALL_MATCHING");
    const requirementId = String(formData.get("requirementId") ?? "");
    const result = await distributeRequirement({
      requirementId,
      mode,
      supplierIds: formData
        .getAll("supplierIds")
        .map((v) => String(v))
        .filter(Boolean),
      responseDeadline: String(formData.get("responseDeadline") ?? ""),
    });
    revalidatePath(`/staff/requirements/${requirementId}`);
    revalidatePath("/staff/requests");
    redirect(`/staff/requests?distributed=${result.count}`);
  } catch (error) {
    if (isNextRedirectError(error)) {
      throw error;
    }
    if (isAuthorizationError(error)) {
      return { ok: false, error: "You do not have permission to do that." };
    }
    if (isRequestDomainError(error)) {
      return { ok: false, error: requestErrorMessage(error) };
    }
    console.error("[distributeRequirementAction]", error);
    const message =
      error instanceof Error ? error.message : String(error ?? "");
    if (message.includes("Unknown argument `responseDeadline`")) {
      return {
        ok: false,
        error:
          "Could not send supplier requests because the running app is using an outdated database client. Restart the Next.js server after prisma generate, then try again.",
      };
    }
    return {
      ok: false,
      error:
        "Could not send supplier requests. Please refresh and try again. If it keeps failing, contact support.",
    };
  }
}
