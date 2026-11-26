"use server";

import { revalidatePath } from "next/cache";

import { confirmOsfImport } from "@/lib/osf-imports/confirm";
import { distributeOsfImport } from "@/lib/osf-imports/distribute";
import {
  createBrandAndResolveImportLines,
  excludeImportLine,
  includeZeroQtyLine,
  linkImportLineToProduct,
  resolveImportLineBrand,
  restoreImportLine,
  updateImportLineQuantity,
} from "@/lib/osf-imports/mutations";
import {
  isOsfImportDomainError,
  osfImportErrorMessage,
} from "@/lib/osf-imports/errors";
import { isAuthorizationError } from "@/lib/auth/errors";
import { isRequestDomainError, requestErrorMessage } from "@/lib/requests/errors";
import { ProductDomainError } from "@/lib/products/errors";
import {
  isSupplierDomainError,
  supplierErrorMessage,
} from "@/lib/suppliers/errors";
import { mapUnresolvedCosmoSupplier } from "@/lib/suppliers/mutations";

export type ActionResult =
  | { ok: true; status?: string; confirmedAt?: string; replay?: boolean }
  | { ok: false; error: string };

export type DistributeActionResult =
  | {
      ok: true;
      replay?: boolean;
      brands: Array<{
        requirementId: string;
        brandName: string;
        status: string;
        requestIds: string[];
        error?: string;
      }>;
    }
  | { ok: false; error: string };

function toError(error: unknown): ActionResult {
  if (isAuthorizationError(error)) {
    return { ok: false, error: "You do not have permission to do that." };
  }
  if (isOsfImportDomainError(error)) {
    return { ok: false, error: osfImportErrorMessage(error) };
  }
  if (isSupplierDomainError(error)) {
    return { ok: false, error: supplierErrorMessage(error) };
  }
  if (error instanceof ProductDomainError) {
    return { ok: false, error: error.message };
  }
  return { ok: false, error: "Something went wrong. Please try again." };
}

function formDataObject(formData: FormData): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") obj[key] = value;
  }
  if (obj.applyToBrandGroup === "false") obj.applyToBrandGroup = false;
  if (obj.applyToBrandGroup === "true") obj.applyToBrandGroup = true;
  return obj;
}

function revalidateImport(importId: string) {
  revalidatePath(`/staff/osf-imports/${importId}`);
  revalidatePath("/staff/osf-imports");
}

export async function updateLineQtyAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const result = await updateImportLineQuantity(formDataObject(formData));
    revalidateImport(result.importId);
    return { ok: true, status: result.status };
  } catch (error) {
    return toError(error);
  }
}

export async function linkProductAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const result = await linkImportLineToProduct(formDataObject(formData));
    revalidateImport(result.importId);
    return { ok: true, status: result.status };
  } catch (error) {
    return toError(error);
  }
}

export async function resolveBrandAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const result = await resolveImportLineBrand(formDataObject(formData));
    revalidateImport(result.importId);
    return { ok: true, status: result.status };
  } catch (error) {
    return toError(error);
  }
}

export async function excludeLineAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const result = await excludeImportLine(formDataObject(formData));
    revalidateImport(result.importId);
    return { ok: true, status: result.status };
  } catch (error) {
    return toError(error);
  }
}

export async function restoreLineAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const result = await restoreImportLine(formDataObject(formData));
    revalidateImport(result.importId);
    return { ok: true, status: result.status };
  } catch (error) {
    return toError(error);
  }
}

export async function includeZeroQtyLineAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const result = await includeZeroQtyLine(formDataObject(formData));
    revalidateImport(result.importId);
    return { ok: true, status: result.status };
  } catch (error) {
    return toError(error);
  }
}

export async function createBrandAndResolveAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const result = await createBrandAndResolveImportLines(
      formDataObject(formData),
    );
    revalidateImport(result.importId);
    return { ok: true, status: result.status };
  } catch (error) {
    return toError(error);
  }
}

export async function confirmImportAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const result = await confirmOsfImport(formDataObject(formData));
    revalidateImport(result.importId);
    return {
      ok: true,
      status: result.status,
      confirmedAt: result.confirmedAt,
      replay: result.replay,
    };
  } catch (error) {
    return toError(error);
  }
}

export async function distributeOsfImportAction(
  _prev: DistributeActionResult | undefined,
  formData: FormData,
): Promise<DistributeActionResult> {
  try {
    let brands: unknown = [];
    const brandsRaw = String(formData.get("brandsJson") ?? "");
    if (brandsRaw) {
      try {
        brands = JSON.parse(brandsRaw);
      } catch {
        return { ok: false, error: "Invalid brand selection payload." };
      }
    }
    const result = await distributeOsfImport({
      importId: String(formData.get("importId") ?? ""),
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      responseDeadline: String(formData.get("responseDeadline") ?? ""),
      acknowledgeOverQty: formData.get("acknowledgeOverQty") === "true",
      retryFailedOnly: formData.get("retryFailedOnly") === "true",
      brands,
    });
    revalidateImport(result.importId);
    revalidatePath(`/staff/osf-imports/${result.importId}/distribute`);
    revalidatePath("/staff/requests");
    return {
      ok: true,
      replay: result.replay,
      brands: result.brands.map((b) => ({
        requirementId: b.requirementId,
        brandName: b.brandName,
        status: b.status,
        requestIds: b.requestIds,
        error: b.error,
      })),
    };
  } catch (error) {
    if (isAuthorizationError(error)) {
      return { ok: false, error: "You do not have permission to do that." };
    }
    if (isOsfImportDomainError(error)) {
      return { ok: false, error: osfImportErrorMessage(error) };
    }
    if (isRequestDomainError(error)) {
      return { ok: false, error: requestErrorMessage(error) };
    }
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

export async function mapUnresolvedCosmoSupplierAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const expectedRaw = formData.get("expectedPortalExternalId");
    const expectedPortalExternalId =
      expectedRaw == null || String(expectedRaw) === ""
        ? null
        : String(expectedRaw);
    await mapUnresolvedCosmoSupplier({
      importId: String(formData.get("importId") ?? ""),
      cosmoSupplierId: String(formData.get("cosmoSupplierId") ?? ""),
      portalSupplierId: String(formData.get("portalSupplierId") ?? ""),
      confirmChange:
        formData.get("confirmChange") === "true" ||
        formData.get("confirmChange") === "on" ||
        formData.get("confirmChange") === "1",
      expectedPortalExternalId,
    });
    const importId = String(formData.get("importId") ?? "");
    revalidateImport(importId);
    revalidatePath("/admin/suppliers");
    return { ok: true };
  } catch (error) {
    return toError(error);
  }
}
