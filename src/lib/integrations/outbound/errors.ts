const messages = {
  NOT_FOUND: "Connection not found.",
  INVALID_INPUT: "Check the connection details and try again.",
  ORIGIN_NOT_APPROVED: "This host is not approved for your company.",
  STALE_VERSION: "This connection changed. Reload it and try again.",
  DUPLICATE_ORIGIN: "A connection already exists for this provider and host.",
  SHOPIFY_ALREADY_ENABLED: "Disable the other Shopify connection first.",
  CREDENTIALS_REQUIRED: "Configure credentials before enabling this connection.",
  KEYRING_UNAVAILABLE: "Credential encryption is not configured.",
  INVALID_CREDENTIAL_BUNDLE: "The stored credential bundle cannot be opened.",
} as const;

export class OutboundIntegrationError extends Error {
  constructor(readonly code: keyof typeof messages) {
    super(messages[code]);
  }
}
