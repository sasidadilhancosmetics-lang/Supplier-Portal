"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { isAuthorizationError } from "@/lib/auth/errors";
import {
  createAdminIntegration,
  testAdminIntegration,
  updateAdminIntegration,
} from "@/lib/integrations/outbound/admin";
import { OutboundIntegrationError } from "@/lib/integrations/outbound/errors";
import { mockMessages } from "@/lib/integrations/outbound/mock-provider";

export type IntegrationActionResult = { ok: boolean; message: string };
const listing = "/admin/settings/integrations";

function actionError(error: unknown): IntegrationActionResult {
  if (isAuthorizationError(error)) return { ok: false, message: "You do not have permission to do that." };
  if (error instanceof OutboundIntegrationError) return { ok: false, message: error.message };
  return { ok: false, message: "The integration action could not be completed." };
}

function target(form: FormData) {
  return { id: form.get("id"), expectedVersion: form.get("expectedVersion") };
}

async function saveConnection(input: ReturnType<typeof target> & { kind: string }, message: string) {
  try {
    await updateAdminIntegration(input);
    revalidatePath(listing);
    revalidatePath(`${listing}/${encodeURIComponent(String(input.id))}`);
    return { ok: true, message };
  } catch (error) {
    return actionError(error);
  }
}

export async function createIntegrationAction(
  _previous: IntegrationActionResult | undefined,
  form: FormData,
) {
  let result;
  try {
    result = await createAdminIntegration({
      provider: form.get("provider"),
      label: form.get("label"),
      origin: form.get("origin"),
    });
  } catch (error) {
    return actionError(error);
  }
  revalidatePath(listing);
  redirect(`${listing}/${encodeURIComponent(result.id)}`);
}

export async function renameIntegrationAction(
  _previous: IntegrationActionResult | undefined,
  form: FormData,
) {
  const input = { ...target(form), kind: "rename", label: form.get("label") };
  return saveConnection(input, "Connection renamed.");
}

export async function setIntegrationEnabledAction(
  _previous: IntegrationActionResult | undefined,
  form: FormData,
) {
  const value = form.get("enabled");
  const input = { ...target(form), kind: "enabled", enabled: value === "true" ? true : value === "false" ? false : null };
  return saveConnection(input, input.enabled ? "Configuration enabled." : "Configuration disabled.");
}

export async function replaceIntegrationCredentialsAction(
  _previous: IntegrationActionResult | undefined,
  form: FormData,
) {
  const input = { ...target(form), kind: "credentials", identifier: form.get("identifier"), secret: form.get("secret") };
  return saveConnection(input, "Credentials saved.");
}

export async function testIntegrationAction(
  _previous: IntegrationActionResult | undefined,
  form: FormData,
) {
  const input = target(form);
  try {
    const result = await testAdminIntegration(input);
    revalidatePath(`${listing}/${encodeURIComponent(String(input.id))}`);
    return { ok: result === "MOCK_PASSED", message: mockMessages[result] };
  } catch (error) {
    return actionError(error);
  }
}
