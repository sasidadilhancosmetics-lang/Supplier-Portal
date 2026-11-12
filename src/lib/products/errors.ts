export type ProductDomainCode =
  | "VALIDATION"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "INVALID_BRAND"
  | "DUPLICATE_SKU"
  | "ERP_RULE";

export class ProductDomainError extends Error {
  readonly code: ProductDomainCode;

  constructor(code: ProductDomainCode, message: string) {
    super(message);
    this.name = "ProductDomainError";
    this.code = code;
  }
}

export function isProductDomainError(
  error: unknown,
): error is ProductDomainError {
  return error instanceof ProductDomainError;
}

export function productErrorMessage(error: unknown): string {
  if (isProductDomainError(error)) {
    return error.message;
  }
  return "Something went wrong. Please try again.";
}
