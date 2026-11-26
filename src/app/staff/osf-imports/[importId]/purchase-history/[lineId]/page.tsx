import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { ErpPurchaseRecords } from "@/components/staff/erp-purchase-records";
import { isAuthorizationError } from "@/lib/auth/errors";
import { todayCalendarDateInPortalTz } from "@/lib/dates";
import { getOsfPurchaseHistory } from "@/lib/osf-imports/purchase-history";

export const instant = false;

const statusText = {
  INVALID_FILTER: "Choose a valid date range of up to 366 days.",
  MAPPING_UNAVAILABLE: "Unavailable. This OSF line lacks a verified product or ERP instance mapping.",
  MAPPING_AMBIGUOUS: "Unavailable. Cosmo has multiple active matches for this exact SKU.",
  SELECT_INSTANCE: "Select an ERP instance and apply the date range.",
  SELECT_COMPANY: "Select an ERP company to view its purchase history.",
  UNCONFIGURED: "ERP purchase history is not configured for this company.",
  UNAVAILABLE: "ERP purchase history is temporarily unavailable.",
};

export default async function PurchaseHistoryPage({ params, searchParams }: {
  params: Promise<{ importId: string; lineId: string }>;
  searchParams: Promise<{ instanceId?: string | string[]; erpCompany?: string | string[]; from?: string | string[]; to?: string | string[]; offset?: string | string[] }>;
}) {
  await connection();
  const [{ importId, lineId }, input] = await Promise.all([params, searchParams]);
  const today = todayCalendarDateInPortalTz();
  const from = input.from ?? new Date(Date.parse(today) - 90 * 86_400_000).toISOString().slice(0, 10);
  const to = input.to ?? today;
  let model;
  try {
    model = await getOsfPurchaseHistory(importId, lineId, { ...input, from, to });
  } catch (error) {
    if (isAuthorizationError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const { product, instances, prices, result } = model;
  const path = "/staff/osf-imports/" + encodeURIComponent(importId) + "/purchase-history/" + encodeURIComponent(lineId);

  return (
    <div className="min-w-0 space-y-6 [overflow-wrap:anywhere]">
      <Link href={"/staff/osf-imports/" + encodeURIComponent(importId)} className="inline-flex min-h-11 items-center underline">Back to OSF review</Link>
      <header>
        <h1 className="text-2xl font-semibold">ERP purchase history</h1>
        <p>{product.name} · {product.sku}</p>
      </header>
      {instances.length > 0 && (
        <form method="get" action={path} className="grid min-w-0 gap-3 rounded-lg border p-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm">ERP instance
            <select name="instanceId" required defaultValue={typeof input.instanceId === "string" ? input.instanceId : ""} className="min-h-11 w-full min-w-0 rounded-md border bg-background px-2">
              <option value="">Select ERP instance</option>
              {instances.map((instance) => <option value={instance} key={instance}>{instance}</option>)}
            </select>
          </label>
          {(result.status === "SELECT_COMPANY" || result.status === "OK") &&
            result.companies && result.companies.length > 1 && (
              <label className="grid gap-1 text-sm">ERP company
                <select name="erpCompany" defaultValue={typeof input.erpCompany === "string" ? input.erpCompany : ""} className="min-h-11 w-full min-w-0 rounded-md border bg-background px-2">
                  <option value="">Choose a company, or clear when changing ERP instance</option>
                  {result.companies.map((company) => <option value={company} key={company}>{company}</option>)}
                </select>
              </label>
            )}
          <label className="grid gap-1 text-sm">From
            <input required type="date" name="from" defaultValue={typeof from === "string" ? from : ""} className="min-h-11 w-full min-w-0 rounded-md border bg-background px-2" />
          </label>
          <label className="grid gap-1 text-sm">To
            <input required type="date" name="to" defaultValue={typeof to === "string" ? to : ""} className="min-h-11 w-full min-w-0 rounded-md border bg-background px-2" />
          </label>
          <button type="submit" className="self-end min-h-11 rounded-md bg-primary px-3 font-medium text-primary-foreground">Apply date filter</button>
        </form>
      )}
      {result.status !== "OK" ? <p role="status">{statusText[result.status]}</p> : (
        <section className="space-y-4" aria-label="Historical ERP purchases">
          <h2 className="text-lg font-semibold">{result.instanceLabel} · {result.instanceId}{result.erpCompany ? " · " + result.erpCompany : ""}</h2>
          <p className="text-sm text-muted-foreground">Retrieved {result.retrievedAt.slice(0, 16).replace("T", " ")} UTC · {result.from} to {result.to}. Invoice lines only. Returns and canceled documents are excluded.</p>
          {result.truncated && <p role="status">Showing a bounded scan of up to 250 invoice lines. Narrow the dates for a complete comparison.</p>}
          {result.hasUnusableRows && <p role="status">Some ERP rows were unavailable for comparison because source fields were missing.</p>}
          <h3 className="font-medium">Latest historical price per ERP supplier</h3>
          {result.latest.length ? <ErpPurchaseRecords rows={result.latest} /> : <p>N/A</p>}
          <h3 className="font-medium">Lowest comparable historical price by currency, unit and pack</h3>
          {result.lowest.length ? <ErpPurchaseRecords rows={result.lowest} /> : <p>N/A. No verified comparable price.</p>}
          <h3 className="font-medium">Invoice lines</h3>
          {result.records.length ? <ErpPurchaseRecords rows={result.records} /> : <p>No purchase history for this page and date range.</p>}
          <div className="flex flex-wrap gap-4">
            {(typeof input.offset === "string" && Number(input.offset) >= 25) && (
              <Link className="inline-flex min-h-11 items-center underline" href={path + "?" + new URLSearchParams({
                instanceId: result.instanceId, ...(result.erpCompany ? { erpCompany: result.erpCompany } : {}), from: result.from, to: result.to, offset: String(Math.max(0, Number(input.offset) - 25)),
              })}>Previous page</Link>
            )}
            {result.nextOffset !== null && (
              <Link className="inline-flex min-h-11 items-center underline" href={path + "?" + new URLSearchParams({
                instanceId: result.instanceId, ...(result.erpCompany ? { erpCompany: result.erpCompany } : {}), from: result.from, to: result.to, offset: String(result.nextOffset),
              })}>Next page</Link>
            )}
          </div>
        </section>
      )}
      <section className="space-y-2" aria-labelledby="portal-catalogue-prices">
        <h2 id="portal-catalogue-prices" className="text-lg font-semibold">Portal supplier catalogue prices</h2>
        <p className="text-sm text-muted-foreground">Latest saved prices by Portal supplier. ERP supplier identities are separate.</p>
        {prices.length ? (
          <ul className="grid min-w-0 gap-2 sm:grid-cols-2">
            {prices.map((row) => (
              <li key={row.supplierId} className="min-w-0 rounded-md border p-3 text-sm">
                <p className="font-medium">{row.supplierName}</p>
                <p>{row.currencyCode} {row.unitPrice} / {row.unitOfMeasure ?? "UOM unavailable"}
                  {row.moq && " · MOQ " + row.moq} · {row.createdAt.toISOString().slice(0, 10)}</p>
              </li>
            ))}
          </ul>
        ) : <p>No saved Portal catalogue prices.</p>}
      </section>
    </div>
  );
}
