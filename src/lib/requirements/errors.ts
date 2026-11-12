export type RequirementDomainCode =
  | "VALIDATION"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "INVALID_BRAND"
  | "INVALID_PRODUCT"
  | "NOT_DRAFT"
  | "EMPTY_ITEMS"
  | "ALREADY_CONFIRMED"
  | "DUPLICATE_PRODUCT";

export class RequirementDomainError extends Error {
  readonly code: RequirementDomainCode;

  constructor(code: RequirementDomainCode, message: string) {
    super(message);
    this.name = "RequirementDomainError";
    this.code = code;
  }
}

export function isRequirementDomainError(
  error: unknown,
): error is RequirementDomainError {
  return error instanceof RequirementDomainError;
}

export function requirementErrorMessage(error: unknown): string {
  if (isRequirementDomainError(error)) {
    return error.message;
  }
  return "Something went wrong. Please try again.";
}
