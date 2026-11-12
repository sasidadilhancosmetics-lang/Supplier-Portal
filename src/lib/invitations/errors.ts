export type InvitationErrorCode =
  | "VALIDATION"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "EXPIRED"
  | "REVOKED"
  | "ALREADY_ACCEPTED"
  | "DUPLICATE_PENDING"
  | "EMAIL_MISMATCH"
  | "EMAIL_UNVERIFIED"
  | "IDENTITY_IN_USE"
  | "USER_CONFLICT"
  | "INVALID_ROLE";

export class InvitationError extends Error {
  readonly code: InvitationErrorCode;

  constructor(code: InvitationErrorCode, message: string) {
    super(message);
    this.name = "InvitationError";
    this.code = code;
  }
}

export function isInvitationError(error: unknown): error is InvitationError {
  return error instanceof InvitationError;
}

export function invitationErrorMessage(error: unknown): string {
  if (isInvitationError(error)) {
    return error.message;
  }
  return "Something went wrong. Please try again.";
}
