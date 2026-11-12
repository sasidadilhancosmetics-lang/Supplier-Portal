import type { UserRole } from "@/generated/prisma/client";

export type ProvisionedAppUser = {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  companyId: string;
  supplierId: string | null;
  isActive: boolean;
};

export type AuthState =
  | { status: "anonymous" }
  | {
      status: "pending";
      /** Auth0 display hints only — never used for authorization or linking. */
      displayEmail: string | null;
      displayName: string | null;
    }
  | {
      status: "provisioned";
      user: ProvisionedAppUser;
    };
