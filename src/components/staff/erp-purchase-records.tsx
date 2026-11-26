import type { ErpPurchase } from "@/lib/integrations/cosmo/purchase-history";

function price(row: ErpPurchase) {
  return row.unitPrice && row.currency && row.uom ? row.currency + " " + row.unitPrice + " / " + row.uom : "N/A";
}

export function ErpPurchaseRecords({ rows }: { rows: ErpPurchase[] }) {
  return (
    <ul className="grid min-w-0 gap-2 sm:grid-cols-2">
      {rows.map((row) => (
        <li key={(row.erpCompany ?? "") + ":" + row.reference + ":" + row.line} className="min-w-0 rounded-md border p-3 text-sm [overflow-wrap:anywhere]">
          {row.erpCompany && <p className="text-muted-foreground">ERP company: {row.erpCompany}</p>}
          <p className="font-medium">{row.supplierName} · {row.supplierId}</p>
          <p>{price(row)} · {row.quantity} {row.uom ?? "UOM unavailable"} · {row.date}</p>
          <p className="text-muted-foreground">{row.documentType} {row.reference} · Line {row.line}</p>
          {(row.purchaseOrder || row.purchaseReceipt) && (
            <p className="text-muted-foreground">
              {row.purchaseOrder && <>PO {row.purchaseOrder} </>}
              {row.purchaseReceipt && <>Receipt {row.purchaseReceipt}</>}
            </p>
          )}
          <p className="text-muted-foreground">
            {row.priceBasis === "UNVERIFIED" ? "Price basis unverified" : "Net before tax · no invoice-level discount"}
            {row.conversionFactor && row.stockUom ? " · Pack factor " + row.conversionFactor + " " + row.stockUom : ""}
          </p>
          <p className="text-muted-foreground">
            Invoice tax {row.invoiceTaxTotal ?? "N/A"}{row.taxTemplate ? " (" + row.taxTemplate + ")" : ""}
            {" · Line discount "}{row.lineDiscountPercent === null ? "N/A" : row.lineDiscountPercent + "%"}
            {" · Invoice discount "}{row.invoiceDiscount ?? "N/A"}
          </p>
        </li>
      ))}
    </ul>
  );
}
