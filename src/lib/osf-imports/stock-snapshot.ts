import { z } from "zod";

import { osfSnapshotDate, osfStockSnapshotSchema } from "@/lib/integrations/cosmo/schema";

const snapshotLineSchema = z.object({
  lineKey: z.string(),
  sku: z.string(),
  snapshot: osfStockSnapshotSchema,
});

export function readStockSnapshot(payload: unknown) {
  const source = z.object({ source: z.object({ asOfDate: osfSnapshotDate }) }).safeParse(payload);
  const imports = z.object({ items: z.array(z.unknown()) }).safeParse(payload);
  const items = imports.success ? imports.data.items : [];
  function snapshotForLine(sourceIndex: number, lineKey: string, sku: string) {
    const item = snapshotLineSchema.safeParse(items[sourceIndex]);
    return item.success && item.data.lineKey === lineKey && item.data.sku === sku
      ? item.data.snapshot
      : undefined;
  }
  return {
    asOfDate: source.success ? source.data.source.asOfDate : null,
    forLine(sourceIndex: number, lineKey: string, sku: string) {
      const snapshot = snapshotForLine(sourceIndex, lineKey, sku);
      return {
        totalStock: snapshot?.totalStock == null ? null : String(snapshot.totalStock),
        totalRop: snapshot?.totalRop == null ? null : String(snapshot.totalRop),
      };
    },
    columnsForLine(sourceIndex: number, lineKey: string, sku: string) {
      return snapshotForLine(sourceIndex, lineKey, sku)?.columns ?? [];
    },
  };
}
