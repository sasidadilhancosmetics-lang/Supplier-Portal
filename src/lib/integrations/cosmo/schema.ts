import { z } from "zod";

import {
  COSMO_OSF_CONTRACT_VERSION,
  COSMO_OSF_IDEMPOTENCY_KEY_MAX,
  COSMO_OSF_IDEMPOTENCY_KEY_MIN,
  COSMO_OSF_MAX_ITEMS,
  COSMO_OSF_MAX_REQUEST_SUGGESTIONS,
  COSMO_OSF_QTY_DECIMAL_SCALE,
} from "./constants";
import { sha256Hex } from "./crypto";
import { CosmoIngestError } from "./errors";

/**
 * Trim ends only — never case-fold. Matching later is exact against these
 * normalized strings so "Sku" cannot silently hit "SKU".
 */
const nonEmptyTrimmed = z.string().trim().min(1);

const optionalTrimmed = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined));

const nullablePriority = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => {
    if (v == null) return null;
    const t = v.trim();
    return t.length > 0 ? t : null;
  });

/** Integer ≥ 0 from Cosmo TOTAL ORDER QTY. Structural negatives / non-integers fail validation. */
const totalOrderQtySchema = z
  .number({ error: "quantity.totalOrderQty must be a number" })
  .finite()
  .int("quantity.totalOrderQty must be an integer")
  .min(0, "quantity.totalOrderQty must be ≥ 0")
  .max(1_000_000_000);

/**
 * Positive finite qty fitting Prisma Decimal(18, 4).
 * Rejects ≤0, non-finite, >1e9, and more than 4 fractional digits.
 */
export function isValidSuggestedRequestQty(value: number): boolean {
  if (!Number.isFinite(value) || value <= 0 || value > 1_000_000_000) {
    return false;
  }
  const scale = 10 ** COSMO_OSF_QTY_DECIMAL_SCALE;
  const scaled = value * scale;
  return Math.abs(scaled - Math.round(scaled)) < 1e-8;
}

const suggestedRequestQtySchema = z
  .number({ error: "suggestedRequestQty must be a number" })
  .finite("suggestedRequestQty must be finite")
  .gt(0, "suggestedRequestQty must be > 0")
  .max(1_000_000_000)
  .refine(isValidSuggestedRequestQty, {
    message: `suggestedRequestQty must fit Decimal(18, ${COSMO_OSF_QTY_DECIMAL_SCALE})`,
  });

const snapshotQuantity = z.union([
  z.number().finite(),
  z.string().max(128).regex(/^-?\d+(?:\.\d+)?$/),
]);

export const osfSnapshotDate = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/);
export const osfStockSnapshotSchema = z.object({
  totalStock: snapshotQuantity.optional(),
  totalRop: snapshotQuantity.optional(),
  columns: z.array(z.object({
    columnKey: nonEmptyTrimmed.max(200),
    erpInstanceId: nonEmptyTrimmed.max(200),
    itemCode: nonEmptyTrimmed.max(200),
    warehouses: z.array(nonEmptyTrimmed.max(300)).min(1),
  })).optional(),
});

export const cosmoOsfItemSchema = z.object({
  lineKey: nonEmptyTrimmed.max(200),
  sku: nonEmptyTrimmed.max(200),
  description: z.string().max(2000),
  barcode: optionalTrimmed,
  brand: z.object({
    cosmoVendorId: nonEmptyTrimmed.max(200),
    name: nonEmptyTrimmed.max(200),
  }),
  priorities: z
    .object({
      erp1: nullablePriority,
      erp2: nullablePriority,
    })
    .optional(),
  quantity: z.object({
    totalOrderQty: totalOrderQtySchema,
  }),
  snapshot: osfStockSnapshotSchema.optional(),
  hints: z
    .object({
      latestSupplierName: optionalTrimmed,
    })
    .optional(),
});

/** Optional Cosmo availability-request suggestion (F2A). Never creates POs. */
export const cosmoOsfRequestSuggestionSchema = z.object({
  lineKey: nonEmptyTrimmed.max(200),
  cosmoSupplierId: nonEmptyTrimmed.max(200),
  cosmoSupplierCode: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  cosmoSupplierName: nonEmptyTrimmed.max(200),
  suggestedRequestQty: suggestedRequestQtySchema,
});

export const cosmoOsfPushPayloadSchema = z.object({
  contractVersion: z.literal(COSMO_OSF_CONTRACT_VERSION),
  idempotencyKey: z
    .string()
    .trim()
    .min(COSMO_OSF_IDEMPOTENCY_KEY_MIN)
    .max(COSMO_OSF_IDEMPOTENCY_KEY_MAX),
  source: z.object({
    system: z.literal("cosmo-os"),
    cosmoCompanyId: nonEmptyTrimmed.max(200),
    sentAt: z.string().trim().min(1).refine((v) => !Number.isNaN(Date.parse(v)), {
      message: "source.sentAt must be ISO-8601",
    }),
    asOfDate: osfSnapshotDate.optional(),
    osfVariant: z.enum(["main", "vat", "non_vat"]).optional(),
    salesMonth: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}$/, "salesMonth must be YYYY-MM")
      .optional(),
    actorUserId: optionalTrimmed,
    actorEmail: optionalTrimmed,
  }),
  selection: z.object({
    mode: z.literal("SUPPLIER_ORDERS_SELECTION"),
    brandFilter: z
      .object({
        cosmoVendorId: optionalTrimmed,
        name: optionalTrimmed,
      })
      .optional(),
    priorityFilter: optionalTrimmed,
  }),
  items: z
    .array(cosmoOsfItemSchema)
    .min(1, "items must contain at least one line")
    .max(
      COSMO_OSF_MAX_ITEMS,
      `items must contain at most ${COSMO_OSF_MAX_ITEMS} lines`,
    ),
  /**
   * Optional. Omitted and [] are equivalent for validation and hashing
   * (empty suggestions are excluded from the canonical hash so Phase C
   * payload hashes remain stable).
   */
  requestSuggestions: z
    .array(cosmoOsfRequestSuggestionSchema)
    .max(
      COSMO_OSF_MAX_REQUEST_SUGGESTIONS,
      `requestSuggestions must contain at most ${COSMO_OSF_MAX_REQUEST_SUGGESTIONS} entries`,
    )
    .optional()
    .default([]),
});

export type CosmoOsfPushPayload = z.infer<typeof cosmoOsfPushPayloadSchema>;
export type CosmoOsfItem = z.infer<typeof cosmoOsfItemSchema>;
export type CosmoOsfRequestSuggestion = z.infer<
  typeof cosmoOsfRequestSuggestionSchema
>;

/** Deterministic suggestion order for payloadHash (lineKey, then cosmoSupplierId). */
export function sortRequestSuggestionsForHash(
  suggestions: CosmoOsfRequestSuggestion[],
): CosmoOsfRequestSuggestion[] {
  return [...suggestions].sort((a, b) => {
    const byLine = a.lineKey.localeCompare(b.lineKey);
    if (byLine !== 0) return byLine;
    return a.cosmoSupplierId.localeCompare(b.cosmoSupplierId);
  });
}

/**
 * Deterministic JSON for payloadHash. Key order is fixed; item order is the
 * inbound array order (sourceIndex). Actor email/id are included so retries
 * with the same business snapshot still match Cosmo's exact body.
 *
 * requestSuggestions: omitted/empty are excluded from the canonical object so
 * hashes match pre-F2A Phase C payloads. Non-empty suggestions are sorted.
 */
export function canonicalOsfPushPayload(
  payload: CosmoOsfPushPayload,
): Record<string, unknown> {
  const canonical: Record<string, unknown> = {
    contractVersion: payload.contractVersion,
    idempotencyKey: payload.idempotencyKey,
    source: {
      system: payload.source.system,
      cosmoCompanyId: payload.source.cosmoCompanyId,
      sentAt: payload.source.sentAt,
      asOfDate: payload.source.asOfDate ?? null,
      osfVariant: payload.source.osfVariant ?? null,
      salesMonth: payload.source.salesMonth ?? null,
      actorUserId: payload.source.actorUserId ?? null,
      actorEmail: payload.source.actorEmail ?? null,
    },
    selection: {
      mode: payload.selection.mode,
      brandFilter: payload.selection.brandFilter
        ? {
            cosmoVendorId: payload.selection.brandFilter.cosmoVendorId ?? null,
            name: payload.selection.brandFilter.name ?? null,
          }
        : null,
      priorityFilter: payload.selection.priorityFilter ?? null,
    },
    items: payload.items.map((item) => ({
      lineKey: item.lineKey,
      sku: item.sku,
      description: item.description,
      barcode: item.barcode ?? null,
      brand: {
        cosmoVendorId: item.brand.cosmoVendorId,
        name: item.brand.name,
      },
      priorities: {
        erp1: item.priorities?.erp1 ?? null,
        erp2: item.priorities?.erp2 ?? null,
      },
      quantity: { totalOrderQty: item.quantity.totalOrderQty },
      snapshot: item.snapshot
        ? {
            totalStock: item.snapshot.totalStock ?? null,
            totalRop: item.snapshot.totalRop ?? null,
            ...(item.snapshot.columns ? { columns: item.snapshot.columns } : {}),
          }
        : null,
      hints: item.hints
        ? { latestSupplierName: item.hints.latestSupplierName ?? null }
        : null,
    })),
  };

  const suggestions = payload.requestSuggestions ?? [];
  if (suggestions.length > 0) {
    canonical.requestSuggestions = sortRequestSuggestionsForHash(suggestions).map(
      (s) => ({
        lineKey: s.lineKey,
        cosmoSupplierId: s.cosmoSupplierId,
        cosmoSupplierCode: s.cosmoSupplierCode ?? null,
        cosmoSupplierName: s.cosmoSupplierName,
        suggestedRequestQty: s.suggestedRequestQty,
      }),
    );
  }

  return canonical;
}

export function hashOsfPushPayload(payload: CosmoOsfPushPayload): string {
  return sha256Hex(JSON.stringify(canonicalOsfPushPayload(payload)));
}

export function parseCosmoOsfPushPayload(body: unknown): CosmoOsfPushPayload {
  const parsed = cosmoOsfPushPayloadSchema.safeParse(body);
  if (!parsed.success) {
    throw new CosmoIngestError(
      "VALIDATION",
      "Request body failed cosmo-osf-push.v1 validation.",
      {
        details: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
    );
  }

  const payload = parsed.data;
  const skus = new Map<string, number>();
  const lineKeys = new Map<string, number>();
  for (let i = 0; i < payload.items.length; i++) {
    const item = payload.items[i]!;
    if (lineKeys.has(item.lineKey)) {
      throw new CosmoIngestError(
        "VALIDATION",
        "Duplicate lineKey in items is not allowed.",
        {
          details: {
            lineKey: item.lineKey,
            indexes: [lineKeys.get(item.lineKey), i],
          },
        },
      );
    }
    lineKeys.set(item.lineKey, i);

    if (skus.has(item.sku)) {
      throw new CosmoIngestError(
        "VALIDATION",
        "Duplicate SKU in items is not allowed.",
        {
          details: {
            sku: item.sku,
            indexes: [skus.get(item.sku), i],
          },
        },
      );
    }
    skus.set(item.sku, i);
  }

  const suggestions = payload.requestSuggestions ?? [];
  const suggestionPairKeys = new Map<string, number>();
  for (let i = 0; i < suggestions.length; i++) {
    const suggestion = suggestions[i]!;
    if (!lineKeys.has(suggestion.lineKey)) {
      throw new CosmoIngestError(
        "VALIDATION",
        "requestSuggestions.lineKey must reference an item in the same payload.",
        {
          details: {
            lineKey: suggestion.lineKey,
            suggestionIndex: i,
          },
        },
      );
    }
    const pairKey = `${suggestion.lineKey}\0${suggestion.cosmoSupplierId}`;
    if (suggestionPairKeys.has(pairKey)) {
      throw new CosmoIngestError(
        "VALIDATION",
        "Duplicate (lineKey, cosmoSupplierId) in requestSuggestions is not allowed.",
        {
          details: {
            lineKey: suggestion.lineKey,
            cosmoSupplierId: suggestion.cosmoSupplierId,
            indexes: [suggestionPairKeys.get(pairKey), i],
          },
        },
      );
    }
    suggestionPairKeys.set(pairKey, i);
  }

  return payload;
}

export function assertContractHeaders(args: {
  contractVersionHeader: string | null;
  idempotencyKeyHeader: string | null;
  payload: CosmoOsfPushPayload;
}) {
  if (args.contractVersionHeader !== COSMO_OSF_CONTRACT_VERSION) {
    throw new CosmoIngestError(
      "VALIDATION",
      `X-Contract-Version must be ${COSMO_OSF_CONTRACT_VERSION}.`,
    );
  }
  if (!args.idempotencyKeyHeader) {
    throw new CosmoIngestError(
      "VALIDATION",
      "Idempotency-Key header is required.",
    );
  }
  if (args.idempotencyKeyHeader !== args.payload.idempotencyKey) {
    throw new CosmoIngestError(
      "VALIDATION",
      "Idempotency-Key header must equal body idempotencyKey.",
    );
  }
}
