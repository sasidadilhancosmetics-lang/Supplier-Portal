import "server-only";

import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";

const contractVersion = "cosmo-purchase-history.v1";
const text = z.string().min(1).max(200);
const bindingSchema = z.strictObject({
  origin: z.string().max(253),
  approvedOrigin: z.string().max(253),
  companyId: text,
  token: z.string().regex(/^[A-Za-z0-9_-]{32,256}$/),
});
const decimal = z.string().max(80).regex(/^-?\d+(?:\.\d+)?$/);
const entry = z.object({
  erpCompany: text.optional(),
  reference: text, line: z.string().regex(/^[1-9]\d{0,9}$/), documentType: z.literal("Purchase Invoice"),
  purchaseOrder: text.nullable(), purchaseReceipt: text.nullable(), supplierId: text, supplierName: text,
  date: z.iso.date(), postingTime: z.string().regex(/^\d{2}:\d{2}:\d{2}\.\d{6}$/).nullish(),
  quantity: decimal, unitPrice: decimal.nullable(),
  priceBasis: z.enum(["NET_BEFORE_TAX_NO_HEADER_DISCOUNT", "UNVERIFIED"]),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable(), uom: text.nullable(), stockUom: text.nullable(),
  conversionFactor: decimal.nullable(), invoiceTaxTotal: decimal.nullable(), taxTemplate: text.nullable(),
  lineDiscountPercent: decimal.nullable(), invoiceDiscount: decimal.nullable(),
});
export type ErpPurchase = z.infer<typeof entry>;
const identity = z.object({
  contractVersion: z.literal(contractVersion), requestId: z.uuid(), companyId: text,
  instanceId: text, sku: text, itemCode: text, from: z.iso.date(), to: z.iso.date(),
});
const responseSchema = z.discriminatedUnion("status", [
  identity.extend({ status: z.literal("MAPPING_UNAVAILABLE") }),
  identity.extend({ status: z.literal("MAPPING_AMBIGUOUS") }),
  identity.extend({ status: z.literal("SELECT_COMPANY"), companies: z.array(text).min(2).max(20) }),
  identity.extend({
    status: z.literal("OK"), instanceLabel: text, erpCompany: text.optional(),
    companies: z.array(text).min(1).max(20).optional(), retrievedAt: z.iso.datetime(),
    records: z.array(entry).max(25), nextOffset: z.number().int().min(25).max(250).nullable(),
    truncated: z.boolean(), hasUnusableRows: z.boolean(),
    latest: z.array(entry).max(250), lowest: z.array(entry).max(250),
  }),
]);

export const historyQuerySchema = z.object({
  instanceId: text.optional(),
  erpCompany: z.preprocess((value) => value === "" ? undefined : value, text.optional()),
  from: z.iso.date(), to: z.iso.date(),
  offset: z.string().regex(/^\d{1,3}$/).transform(Number).pipe(z.number().int().max(250)).optional(),
}).refine(({ from, to }) => to >= from && Date.parse(to) - Date.parse(from) <= 366 * 86_400_000);

function companyBinding(companyId: string) {
  const decoded: unknown = JSON.parse(process.env.PORTAL_COSMO_PURCHASE_HISTORY_JSON ?? "{}");
  if (!decoded || typeof decoded !== "object" || !Object.hasOwn(decoded, companyId)) return null;
  return bindingSchema.parse((decoded as Record<string, unknown>)[companyId]);
}

async function readResponse(response: Response): Promise<unknown> {
  const body = response.body?.getReader();
  if (!body) throw new Error("Missing history response");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "";
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await body.read();
      if (done) return JSON.parse(text + decoder.decode());
      size += value.length;
      if (size > 1024 * 1024) {
        await body.cancel().catch(() => undefined);
        throw new Error("History response too large");
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    body.releaseLock();
  }
}

export async function lookupPurchaseHistory(
  companyId: string,
  input: { instanceId: string; erpCompany?: string; sku: string; itemCode: string; from: string; to: string; offset: number },
  request = fetch,
) {
  try {
    const binding = companyBinding(companyId);
    if (!binding) return { status: "UNCONFIGURED" } as const;
    const origin = new URL(binding.origin);
    if (binding.origin !== origin.origin || binding.approvedOrigin !== origin.origin ||
        origin.protocol !== "https:" || origin.port || isIP(origin.hostname) || !origin.hostname.includes(".")) {
      return { status: "UNAVAILABLE" } as const;
    }
    const requestId = randomUUID();
    const url = new URL("/api/integrations/supplier-portal/v1/purchase-history", origin);
    url.search = new URLSearchParams({ ...input, offset: String(input.offset), requestId }).toString();
    const response = await request(url, {
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12_000),
      headers: { Authorization: "Bearer " + binding.token, "X-Portal-Company-Id": companyId },
    });
    if (!response.ok) return { status: "UNAVAILABLE" } as const;
    const parsed = responseSchema.parse(await readResponse(response));
    if (parsed.requestId !== requestId || parsed.companyId !== binding.companyId ||
        parsed.instanceId !== input.instanceId || parsed.sku !== input.sku || parsed.itemCode !== input.itemCode ||
        parsed.from !== input.from || parsed.to !== input.to ||
        (input.erpCompany !== undefined && parsed.status === "SELECT_COMPANY") ||
        (input.erpCompany !== undefined && parsed.status === "OK" && parsed.erpCompany !== input.erpCompany) ||
        (parsed.status === "OK" && [...parsed.records, ...parsed.latest, ...parsed.lowest].some((record) =>
          input.erpCompany !== undefined ? record.erpCompany !== parsed.erpCompany :
            record.erpCompany !== undefined && record.erpCompany !== parsed.erpCompany)) ||
        (parsed.status === "OK" && parsed.nextOffset !== null && parsed.nextOffset !== input.offset + 25)) {
      return { status: "UNAVAILABLE" } as const;
    }
    return parsed;
  } catch {
    return { status: "UNAVAILABLE" } as const;
  }
}
