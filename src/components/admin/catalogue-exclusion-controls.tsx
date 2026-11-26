"use client";

import { useActionState } from "react";

import { refreshCataloguePhotoAction, refreshCataloguePhotoBatchAction, updateCatalogueExclusionAction } from "@/app/admin/suppliers/catalogue-actions";
import { Button } from "@/components/ui/button";

export function CatalogueExclusionControls({ supplierId, productId, hidden, needsReview }: {
  supplierId: string; productId: string; hidden: boolean; needsReview: boolean;
}) {
  const [state, update, saving] = useActionState(updateCatalogueExclusionAction, {});
  const [photoState, refreshPhoto, refreshing] = useActionState(refreshCataloguePhotoAction, {});
  return (
    <div className="w-full space-y-2 sm:w-auto">
      <form action={update}>
        <input type="hidden" name="supplierId" value={supplierId} />
        <input type="hidden" name="productId" value={productId} />
        <input type="hidden" name="operation" value={hidden ? "restore" : "hide"} />
        <Button type="submit" variant="outline" disabled={saving} className="min-h-11">
          {hidden ? "Restore to catalogue" : "Hide from catalogue"}
        </Button>
        {state.message ? <p role={state.error ? "alert" : "status"} className="text-sm">{state.message}</p> : null}
      </form>
      <form action={refreshPhoto} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="productId" value={productId} />
        <Button type="submit" variant="outline" disabled={refreshing} className="min-h-11">
          {refreshing ? "Refreshing…" : needsReview ? "Check photo candidates" : "Refresh photo"}
        </Button>
        {photoState.message ? <p role={photoState.error ? "alert" : "status"} className="basis-full text-sm">{photoState.message}</p> : null}
      </form>
      {photoState.candidates?.length ? (
        <ul className="space-y-2">
          {photoState.candidates.map((candidate) => (
            <li key={candidate.id} className="rounded-md border p-2">
              <form action={refreshPhoto} className="flex flex-wrap items-center gap-2 text-sm">
                <input type="hidden" name="productId" value={productId} />
                <input type="hidden" name="cosmoProductItemId" value={candidate.id} />
                <span>Variant {candidate.variant}</span>
                {candidate.imageUrl ? <a href={candidate.imageUrl} target="_blank" rel="noreferrer" className="underline">View photo</a> : <span>No photo</span>}
                <Button type="submit" variant="outline" disabled={refreshing} className="min-h-11">Approve mapping</Button>
              </form>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function CataloguePhotoBatchControl() {
  const [state, refresh, pending] = useActionState(refreshCataloguePhotoBatchAction, {});
  return (
    <form action={refresh} className="space-y-2">
      {state.next ? <input type="hidden" name="after" value={state.next} /> : null}
      <Button type="submit" variant="outline" disabled={pending} className="min-h-11">
        {pending ? "Refreshing…" : state.next ? "Refresh next photo batch" : "Refresh catalogue photos"}
      </Button>
      {state.message ? <p role={state.error ? "alert" : "status"} className="text-sm">{state.message}</p> : null}
    </form>
  );
}
