"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth/guards";
import { refreshCataloguePhoto, refreshCataloguePhotoBatch } from "@/lib/integrations/cosmo/product-media";
import { setCatalogueExclusion } from "@/lib/supplier/catalogue-admin";

type State = {
  message?: string;
  error?: boolean;
  next?: string | null;
  candidates?: { id: string; variant: string; imageUrl: string | null }[];
};
const validId = z.string().min(1).max(128);

export async function updateCatalogueExclusionAction(_: State, form: FormData): Promise<State> {
  const supplierId = validId.safeParse(form.get("supplierId"));
  const productId = validId.safeParse(form.get("productId"));
  const operation = form.get("operation");
  if (!supplierId.success || !productId.success || (operation !== "hide" && operation !== "restore")) {
    await requireAdmin();
    return { message: "This product is unavailable.", error: true };
  }
  if (!await setCatalogueExclusion(supplierId.data, productId.data, operation === "hide")) {
    return { message: "This product is unavailable.", error: true };
  }
  revalidatePath("/admin/suppliers/[id]", "page");
  revalidatePath("/supplier/catalogue", "layout");
  return { message: operation === "hide" ? "Hidden from this supplier’s catalogue." : "Catalogue exclusion removed." };
}

export async function refreshCataloguePhotoAction(_: State, form: FormData): Promise<State> {
  const productId = validId.safeParse(form.get("productId"));
  const review = form.get("cosmoProductItemId");
  const candidate = review ? validId.safeParse(review) : null;
  if (!productId.success || (candidate && !candidate.success)) {
    await requireAdmin();
    return { message: "This product is unavailable.", error: true };
  }
  const result = await refreshCataloguePhoto(productId.data, candidate?.data);
  revalidatePath("/admin/suppliers/[id]", "page");
  revalidatePath("/supplier/catalogue", "layout");
  return {
    error: result.outcome !== "APPROVED",
    candidates: result.candidates,
    message: {
      UNCONFIGURED: "Photo enrichment is not configured.",
      UNAVAILABLE: "No verified photo is available.",
      STALE: "The mapping changed. Refresh and try again.",
      NEEDS_REVIEW: "Photo mapping needs review.",
      APPROVED: "Photo updated.",
      FAILED: "Photo refresh failed. Any existing photo was kept.",
    }[result.outcome],
  };
}

export async function refreshCataloguePhotoBatchAction(_: State, form: FormData): Promise<State> {
  const raw = form.get("after");
  const after = validId.safeParse(raw);
  if (raw && !after.success) {
    await requireAdmin();
    return { message: "Invalid refresh cursor.", error: true };
  }
  const { results, next } = await refreshCataloguePhotoBatch(after.data);
  revalidatePath("/admin/suppliers/[id]", "page");
  revalidatePath("/supplier/catalogue", "layout");
  if (results.some(({ outcome }) => outcome === "UNCONFIGURED")) {
    return { message: "Photo enrichment is not configured.", error: true };
  }
  if (results.some(({ outcome }) => outcome === "FAILED")) {
    return { message: "The photo refresh failed. Existing photos were kept.", error: true };
  }
  const approved = results.filter(({ outcome }) => outcome === "APPROVED").length;
  const review = results.filter(({ outcome }) => outcome === "NEEDS_REVIEW").length;
  return { next, message: `Checked ${results.length} products: ${approved} with photos, ${review} need review.` };
}
