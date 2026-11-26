export type LastPurchasePrice = {
  unitPrice: string;
  currencyCode: string;
  purchasedAt: Date;
  purchasedAtLabel: string;
  orderNumber: string | null;
};

export type SupplierQuoteSnapshot = {
  unitPrice: string;
  currencyCode: string;
  kind: string;
  createdAt: Date;
  createdAtLabel: string;
};

export type CounterNegotiationDisplay = {
  companyCounterPrice: string;
  currencyCode: string;
  /** Supplier quote that the company countered (current original on this thread). */
  currentSupplierQuote: SupplierQuoteSnapshot | null;
  /** Older quote from this supplier for the same product (not the current thread quote). */
  previousQuotedPrice: SupplierQuoteSnapshot | null;
  lastPurchase: LastPurchasePrice | null;
};
