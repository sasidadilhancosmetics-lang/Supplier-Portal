"use client";

import { useActionState, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";

import { saveCataloguePriceAction, type CataloguePriceState } from "@/app/supplier/catalogue/actions";
import { Button } from "@/components/ui/button";
import { catalogueImageUrl } from "@/lib/supplier/catalogue-image";
import { formatCataloguePrice } from "@/lib/supplier/catalogue-price-format";

export type CatalogueCardProduct = {
  productId: string; importId: string; sku: string; title: string; brand: string; uom: string | null;
  imageUrl: string | null; imageAlt: string | null; unitPrice: string | null; moq: string | null; revision: number | null;
};

export function CatalogueCard({ product, showDetailLink = true }: {
  product: CatalogueCardProduct; showDetailLink?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [updatedPrice, setUpdatedPrice] = useState<CataloguePriceState["saved"]>();
  const [key, setKey] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [moq, setMoq] = useState("");
  const cardRef = useRef<HTMLElement>(null);
  const unitPriceRef = useRef<HTMLInputElement>(null);
  const priceActionRef = useRef<HTMLButtonElement>(null);
  const restorePriceAction = useRef(false);
  const [state, save, pending] = useActionState(async (previous: CataloguePriceState, data: FormData) => {
    const result = await saveCataloguePriceAction(previous, data);
    if (!result.message) {
      restorePriceAction.current = document.activeElement === document.body ||
        Boolean(cardRef.current?.contains(document.activeElement));
      setUpdatedPrice(result.saved);
      setSaved(true);
      setEditing(false);
    }
    return result;
  }, {});
  useLayoutEffect(() => {
    if (editing) {
      unitPriceRef.current?.focus();
    } else if (restorePriceAction.current) {
      restorePriceAction.current = false;
      priceActionRef.current?.focus();
    }
  }, [editing]);

  useLayoutEffect(() => {
    const card = cardRef.current;
    return () => {
      if (!card?.contains(document.activeElement)) return;
      queueMicrotask(() => {
        if (!card.isConnected && document.activeElement === document.body) {
          document.getElementById("catalogue-search")?.focus();
        }
      });
    };
  }, []);
  const price = updatedPrice && updatedPrice.revision >= (product.revision ?? 0) ? updatedPrice : product;
  const image = catalogueImageUrl(product.imageUrl);
  return (
    <article ref={cardRef} className="min-w-0 space-y-3 rounded-xl border border-border bg-card p-3 sm:p-4">
      <div className="flex min-w-0 gap-3">
        <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted sm:size-20">
          {image && failedImage !== image ? (
            // Direct public CDN image. Avoid using a server-side image proxy.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt={product.imageAlt || product.title} width={80} height={80} loading="lazy"
              className="size-full object-contain" referrerPolicy="no-referrer" onError={() => setFailedImage(image)} />
          ) : <span className="px-1 text-center text-xs text-muted-foreground">No photo</span>}
        </div>
        <div className="min-w-0 space-y-0.5 [overflow-wrap:anywhere]">
          <h2 className="font-semibold">
            {showDetailLink ? <Link href={`/supplier/catalogue/${encodeURIComponent(product.productId)}`} className="underline-offset-4 hover:underline">{product.title}</Link> : product.title}
          </h2>
          <p className="text-sm text-muted-foreground">{product.brand} · {product.sku}</p>
          <p className="text-sm font-medium tabular-nums">{formatCataloguePrice(price)}</p>
        </div>
      </div>
      {saved && !editing ? <p role="status" className="text-sm">Price saved.</p> : null}
      {editing ? (
        <form action={save} className="grid gap-2 rounded-md border p-3" aria-busy={pending}>
          <input type="hidden" name="productId" value={product.productId} />
          <input type="hidden" name="osfImportId" value={product.importId} />
          <input type="hidden" name="expectedRevision" value={price.revision ?? 0} />
          <input type="hidden" name="idempotencyKey" value={key} />
          <label className="grid gap-1 text-sm">
            Unit price (LKR){product.uom ? ` per ${product.uom}` : ""}
            <input ref={unitPriceRef} required name="unitPrice" inputMode="decimal" value={unitPrice} onChange={(event) => setUnitPrice(event.target.value)} disabled={pending}
              className="min-h-11 w-full min-w-0 rounded-md border bg-background px-2 text-base" maxLength={19} />
          </label>
          <label className="grid gap-1 text-sm">
            Minimum order quantity (optional)
            <input name="moq" inputMode="decimal" value={moq} onChange={(event) => setMoq(event.target.value)} disabled={pending}
              className="min-h-11 w-full min-w-0 rounded-md border bg-background px-2 text-base" maxLength={19} />
          </label>
          {state.message ? <p role="alert" className="text-sm text-destructive">{state.message}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending} className="min-h-11">{pending ? "Saving…" : "Save price"}</Button>
            <Button type="button" variant="outline" disabled={pending} className="min-h-11" onClick={() => {
              restorePriceAction.current = true;
              setEditing(false);
            }}>Cancel</Button>
          </div>
        </form>
      ) : (
        <Button ref={priceActionRef} type="button" className="min-h-11 w-full sm:w-fit" onClick={() => {
          setKey(crypto.randomUUID());
          setUnitPrice(price.unitPrice ?? "");
          setMoq(price.moq ?? "");
          setSaved(false);
          setEditing(true);
        }}>{price.unitPrice ? "Update Price" : "Add Price"}</Button>
      )}
    </article>
  );
}
