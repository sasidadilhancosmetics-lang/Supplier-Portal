"use server";

import { revalidatePath } from "next/cache";

import { saveCataloguePrice } from "@/lib/supplier/catalogue";

export type CataloguePriceState = {
  message?: string;
  saved?: { revision: number; unitPrice: string; moq: string | null };
};

export async function saveCataloguePriceAction(_: CataloguePriceState, data: FormData): Promise<CataloguePriceState> {
  const revision = data.get("expectedRevision");
  const productId = data.get("productId");
  let result: Awaited<ReturnType<typeof saveCataloguePrice>>;
  try {
    result = await saveCataloguePrice({
      productId,
      osfImportId: data.get("osfImportId"),
      expectedRevision: typeof revision === "string" && /^\d+$/.test(revision) ? Number(revision) : null,
      idempotencyKey: data.get("idempotencyKey"),
      unitPrice: data.get("unitPrice"),
      moq: String(data.get("moq") ?? "").trim() || null,
    });
  } catch {
    return { message: "The price could not be saved. Try again." };
  }
  if (result.status === "SAVED") {
    revalidatePath("/supplier/catalogue");
    if (typeof productId === "string") revalidatePath(`/supplier/catalogue/${encodeURIComponent(productId)}`);
    return { saved: { revision: result.revision, unitPrice: result.unitPrice, moq: result.moq } };
  }
  return { message: {
    INVALID: "Enter a positive price with up to 2 decimal places and, if used, a positive MOQ with up to 4.",
    CONFLICT: "The catalogue or price changed. Refresh and try again.",
    UNAVAILABLE: "This product is unavailable.",
  }[result.status] };
}
