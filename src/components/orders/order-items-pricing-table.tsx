import { Badge } from "@/components/ui/badge";
import { formatCalendarDate, formatDateTime } from "@/lib/dates";
import {
  orderLinePriceView,
  orderPriceTotalsView,
} from "@/lib/orders/order-pricing";

type OrderItemRow = {
  id: string;
  quantityOrdered: { toString(): string } | string | number;
  quantityCancelled: { toString(): string } | string | number;
  unitPrice: { toString(): string } | string | number | null;
  originalExpectedDeliveryAt: Date | string | null;
  status?: string;
  product: {
    name: string;
    sku: string | null;
  };
  availabilityOffer?: {
    reserveExpiresAt: Date | string | null;
  } | null;
};

/**
 * Shared PO line table for supplier + staff.
 * Prices come only from OrderItem.unitPrice snapshots.
 */
export function OrderItemsPricingTable({
  items,
  currencyCode,
  showReserve = false,
  showLineStatus = false,
}: {
  items: OrderItemRow[];
  currencyCode?: string | null;
  showReserve?: boolean;
  showLineStatus?: boolean;
}) {
  const lineViews = items.map((item) =>
    orderLinePriceView({
      quantityOrdered: item.quantityOrdered.toString(),
      unitPrice: item.unitPrice?.toString() ?? null,
      currencyCode,
    }),
  );
  const totals = orderPriceTotalsView(
    lineViews.map((v) => ({ lineTotal: v.lineTotal })),
    currencyCode,
  );
  const columnCount =
    6 + (showReserve ? 1 : 0) + (showLineStatus ? 1 : 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b bg-muted/50">
            <tr>
              <th className="px-3 py-3 font-medium">Product</th>
              <th className="px-3 py-3 font-medium">Ordered</th>
              <th className="px-3 py-3 font-medium">Unit price</th>
              <th className="px-3 py-3 font-medium">Line total</th>
              <th className="px-3 py-3 font-medium">Cancelled</th>
              <th className="px-3 py-3 font-medium">Expected delivery</th>
              {showReserve ? (
                <th className="px-3 py-3 font-medium">Offer reserve</th>
              ) : null}
              {showLineStatus ? (
                <th className="px-3 py-3 font-medium">Line status</th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => {
              const pricing = lineViews[index]!;
              return (
                <tr key={item.id} className="border-b last:border-0">
                  <td className="px-3 py-3">
                    <div className="font-medium">{item.product.name}</div>
                    <div className="text-muted-foreground">
                      {item.product.sku ?? "—"}
                    </div>
                  </td>
                  <td className="px-3 py-3 tabular-nums">
                    {item.quantityOrdered.toString()}
                  </td>
                  <td className="px-3 py-3 tabular-nums">
                    {pricing.unitPriceLabel}
                  </td>
                  <td className="px-3 py-3 tabular-nums font-medium">
                    {pricing.lineTotalLabel}
                  </td>
                  <td className="px-3 py-3 tabular-nums">
                    {item.quantityCancelled.toString()}
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {formatCalendarDate(item.originalExpectedDeliveryAt)}
                  </td>
                  {showReserve ? (
                    <td className="px-3 py-3 text-muted-foreground">
                      {formatDateTime(
                        item.availabilityOffer?.reserveExpiresAt ?? null,
                      )}
                    </td>
                  ) : null}
                  {showLineStatus ? (
                    <td className="px-3 py-3">
                      <Badge variant="outline">{item.status}</Badge>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t bg-muted/30">
              <td className="px-3 py-3 font-medium" colSpan={3}>
                Total order value
              </td>
              <td
                className="px-3 py-3 font-semibold tabular-nums"
                colSpan={columnCount - 3}
              >
                {totals.totalLabel}
                {!totals.allLinesPriced && totals.hasAnyPrice ? (
                  <span className="mt-1 block text-xs font-normal text-muted-foreground">
                    {totals.missingPriceCount} line
                    {totals.missingPriceCount === 1 ? "" : "s"} missing a
                    recorded price
                  </span>
                ) : null}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Agreed prices are the values saved on this purchase order. Later quote
        changes do not alter these figures.
      </p>
    </div>
  );
}
