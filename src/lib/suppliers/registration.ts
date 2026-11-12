import "server-only";

import type { Prisma } from "@/generated/prisma/client";

import { AuthorizationError } from "@/lib/auth/errors";
import { requireAdmin } from "@/lib/auth/guards";
import { resolveAuth0Issuer } from "@/lib/auth/issuer";
import { getAuth0Session } from "@/lib/auth/auth0-session";
import { getPurchasingCompanyId } from "@/lib/company";
import { prisma } from "@/lib/db";
import { createId } from "@/lib/id";
import { normalizeEmail } from "@/lib/invitations/crypto";
import { createUserNotification } from "@/lib/notifications";

import { writeSupplierAuditLog } from "./audit";
import { SupplierDomainError } from "./errors";
import {
  rejectSupplierRegistrationSchema,
  supplierSelfRegistrationSchema,
} from "./schema";

const AUTH0_PROVIDER = "auth0";

async function assertUniqueSupplierName(
  companyId: string,
  name: string,
  tx: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const existing = await tx.supplier.findFirst({
    where: {
      companyId,
      name: { equals: name, mode: "insensitive" },
      status: { not: "REJECTED" },
    },
    select: { id: true },
  });
  if (existing) {
    throw new SupplierDomainError(
      "DUPLICATE_NAME",
      "A supplier with this company name already exists.",
    );
  }
}

async function assertBrandsBelongToCompany(
  companyId: string,
  brandIds: string[],
  tx: Prisma.TransactionClient | typeof prisma = prisma,
) {
  if (brandIds.length === 0) return;
  const uniqueIds = [...new Set(brandIds)];
  const count = await tx.brand.count({
    where: { companyId, id: { in: uniqueIds } },
  });
  if (count !== uniqueIds.length) {
    throw new SupplierDomainError(
      "INVALID_BRAND",
      "One or more selected brands are invalid.",
    );
  }
}

/**
 * Brands available for self-registration (purchasing company catalog).
 * Caller must already be an authenticated Auth0 session without a portal user.
 */
export async function listBrandsForRegistration() {
  const companyId = await getPurchasingCompanyId();
  return prisma.brand.findMany({
    where: { companyId },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}

export async function getOwnRegistrationStatus() {
  const state = await import("@/lib/auth/session").then((m) =>
    m.getAuthState(),
  );

  if (state.status === "anonymous") {
    throw new AuthorizationError("UNAUTHENTICATED");
  }

  if (state.status === "pending") {
    return { kind: "unlinked" as const };
  }

  if (state.user.role !== "SUPPLIER" || !state.user.supplierId) {
    return { kind: "not_supplier" as const, role: state.user.role };
  }

  const supplier = await prisma.supplier.findFirst({
    where: {
      id: state.user.supplierId,
      companyId: state.user.companyId,
    },
    select: {
      id: true,
      name: true,
      status: true,
      registrationSource: true,
      rejectionReason: true,
      reviewedAt: true,
      createdAt: true,
    },
  });

  if (!supplier) {
    throw new SupplierDomainError("NOT_FOUND", "Supplier not found.");
  }

  return {
    kind: "supplier" as const,
    supplier,
    userId: state.user.id,
  };
}

/**
 * Self-register a new supplier company + SUPPLIER user linked to Auth0.
 * Requires verified Auth0 email and no existing ExternalIdentity / User mapping.
 */
export async function registerSupplierCompany(raw: unknown) {
  let session;
  try {
    session = await getAuth0Session();
  } catch {
    throw new AuthorizationError("UNAUTHENTICATED");
  }
  if (!session?.user?.sub) {
    throw new AuthorizationError("UNAUTHENTICATED");
  }

  if (session.user.email_verified !== true) {
    throw new SupplierDomainError(
      "EMAIL_UNVERIFIED",
      "Verify your email with Auth0 before registering as a supplier.",
    );
  }

  const authEmail =
    typeof session.user.email === "string"
      ? normalizeEmail(session.user.email)
      : "";
  if (!authEmail || !authEmail.includes("@")) {
    throw new SupplierDomainError(
      "VALIDATION",
      "Your Auth0 account must have an email address.",
    );
  }

  const issuer = resolveAuth0Issuer(session.user as Record<string, unknown>);
  if (!issuer) {
    throw new SupplierDomainError(
      "VALIDATION",
      "Auth0 issuer is unavailable.",
    );
  }

  const parsed = supplierSelfRegistrationSchema.safeParse(raw);
  if (!parsed.success) {
    throw new SupplierDomainError(
      "VALIDATION",
      parsed.error.issues[0]?.message ?? "Invalid registration details.",
    );
  }
  const input = parsed.data;
  const brandIds = [...new Set(input.brandIds)];
  const contactEmail = input.contactEmail
    ? normalizeEmail(input.contactEmail)
    : authEmail;

  const companyId = await getPurchasingCompanyId();

  return prisma.$transaction(async (tx) => {
    const existingIdentity = await tx.externalIdentity.findUnique({
      where: {
        provider_providerIssuer_providerSubject: {
          provider: AUTH0_PROVIDER,
          providerIssuer: issuer,
          providerSubject: session.user.sub,
        },
      },
      include: { user: { select: { id: true, role: true, supplierId: true } } },
    });

    if (existingIdentity) {
      throw new SupplierDomainError(
        "ALREADY_REGISTERED",
        "This Auth0 account is already linked to a portal user.",
      );
    }

    const existingUser = await tx.user.findUnique({
      where: { email: authEmail },
      select: { id: true, role: true },
    });
    if (existingUser) {
      throw new SupplierDomainError(
        "USER_CONFLICT",
        "That email is already linked to a portal account. Ask an admin for an invitation instead.",
      );
    }

    await assertUniqueSupplierName(companyId, input.name, tx);
    await assertBrandsBelongToCompany(companyId, brandIds, tx);

    const supplierId = createId();
    const userId = createId();
    const name =
      typeof session.user.name === "string" ? session.user.name : input.contactName;

    const supplier = await tx.supplier.create({
      data: {
        id: supplierId,
        companyId,
        name: input.name,
        status: "PENDING_REVIEW",
        registrationSource: "SELF",
        supportsAllBrands: input.supportsAllBrands,
        contactName: input.contactName,
        contactEmail,
        contactPhone: input.contactPhone ?? null,
        brands: {
          create: brandIds.map((brandId) => ({ brandId })),
        },
      },
    });

    await tx.user.create({
      data: {
        id: userId,
        companyId,
        supplierId,
        role: "SUPPLIER",
        email: authEmail,
        name,
        isActive: true,
      },
    });

    await tx.externalIdentity.create({
      data: {
        id: createId(),
        userId,
        provider: AUTH0_PROVIDER,
        providerIssuer: issuer,
        providerSubject: session.user.sub,
        lastLoginAt: new Date(),
      },
    });

    await writeSupplierAuditLog({
      tx,
      actorUserId: userId,
      entityId: supplier.id,
      action: "CREATE",
      afterJson: {
        event: "SUPPLIER_SELF_REGISTERED",
        name: supplier.name,
        status: supplier.status,
        registrationSource: "SELF",
        brandIds,
        supportsAllBrands: input.supportsAllBrands,
      },
    });

    return {
      supplierId: supplier.id,
      userId,
      status: supplier.status,
    };
  });
}

export async function listPendingSelfRegistrations() {
  const admin = await requireAdmin();

  const rows = await prisma.supplier.findMany({
    where: {
      companyId: admin.companyId,
      registrationSource: "SELF",
      status: "PENDING_REVIEW",
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      contactName: true,
      contactEmail: true,
      contactPhone: true,
      supportsAllBrands: true,
      createdAt: true,
      users: {
        where: { role: "SUPPLIER" },
        select: { id: true, email: true, name: true },
        take: 3,
      },
      brands: {
        include: { brand: { select: { id: true, name: true } } },
        orderBy: { brand: { name: "asc" } },
      },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    contactName: row.contactName,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    supportsAllBrands: row.supportsAllBrands,
    createdAt: row.createdAt,
    applicants: row.users,
    brands: row.brands.map((b) => ({
      id: b.brand.id,
      name: b.brand.name,
    })),
  }));
}

export async function approveSupplierRegistration(supplierId: string) {
  const admin = await requireAdmin();
  const now = new Date();

  const existing = await prisma.supplier.findFirst({
    where: {
      id: supplierId,
      companyId: admin.companyId,
      registrationSource: "SELF",
    },
    select: {
      id: true,
      status: true,
      name: true,
      users: {
        where: { role: "SUPPLIER", isActive: true },
        select: { id: true },
      },
    },
  });

  if (!existing) {
    throw new SupplierDomainError("NOT_FOUND", "Registration not found.");
  }

  if (existing.status === "ACTIVE") {
    return { id: existing.id, status: "ACTIVE" as const, already: true };
  }

  if (existing.status !== "PENDING_REVIEW") {
    throw new SupplierDomainError(
      "INVALID_STATUS",
      "Only pending registrations can be approved.",
    );
  }

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.supplier.updateMany({
      where: {
        id: existing.id,
        status: "PENDING_REVIEW",
        registrationSource: "SELF",
      },
      data: {
        status: "ACTIVE",
        rejectionReason: null,
        reviewedAt: now,
        reviewedByUserId: admin.id,
      },
    });

    if (claimed.count !== 1) {
      throw new SupplierDomainError(
        "INVALID_STATUS",
        "Registration was already reviewed.",
      );
    }

    await writeSupplierAuditLog({
      tx,
      actorUserId: admin.id,
      entityId: existing.id,
      action: "STATUS_CHANGE",
      beforeJson: { status: "PENDING_REVIEW" },
      afterJson: {
        status: "ACTIVE",
        event: "REGISTRATION_APPROVED",
      },
    });

    for (const user of existing.users) {
      await createUserNotification({
        tx,
        userId: user.id,
        title: "Supplier registration approved",
        body: `${existing.name} is now active. You can open the supplier portal.`,
        entityType: "Supplier",
        entityId: existing.id,
      });
    }
  });

  return { id: existing.id, status: "ACTIVE" as const, already: false };
}

export async function rejectSupplierRegistration(raw: unknown) {
  const admin = await requireAdmin();
  const parsed = rejectSupplierRegistrationSchema.safeParse(raw);
  if (!parsed.success) {
    throw new SupplierDomainError(
      "VALIDATION",
      parsed.error.issues[0]?.message ?? "Invalid rejection.",
    );
  }

  const now = new Date();
  const existing = await prisma.supplier.findFirst({
    where: {
      id: parsed.data.supplierId,
      companyId: admin.companyId,
      registrationSource: "SELF",
    },
    select: {
      id: true,
      status: true,
      name: true,
      users: {
        where: { role: "SUPPLIER" },
        select: { id: true },
      },
    },
  });

  if (!existing) {
    throw new SupplierDomainError("NOT_FOUND", "Registration not found.");
  }

  if (existing.status === "REJECTED") {
    return { id: existing.id, status: "REJECTED" as const, already: true };
  }

  if (existing.status !== "PENDING_REVIEW") {
    throw new SupplierDomainError(
      "INVALID_STATUS",
      "Only pending registrations can be rejected.",
    );
  }

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.supplier.updateMany({
      where: {
        id: existing.id,
        status: "PENDING_REVIEW",
        registrationSource: "SELF",
      },
      data: {
        status: "REJECTED",
        rejectionReason: parsed.data.reason,
        reviewedAt: now,
        reviewedByUserId: admin.id,
      },
    });

    if (claimed.count !== 1) {
      throw new SupplierDomainError(
        "INVALID_STATUS",
        "Registration was already reviewed.",
      );
    }

    await writeSupplierAuditLog({
      tx,
      actorUserId: admin.id,
      entityId: existing.id,
      action: "STATUS_CHANGE",
      beforeJson: { status: "PENDING_REVIEW" },
      afterJson: {
        status: "REJECTED",
        event: "REGISTRATION_REJECTED",
        reason: parsed.data.reason,
      },
    });

    for (const user of existing.users) {
      await createUserNotification({
        tx,
        userId: user.id,
        title: "Supplier registration rejected",
        body: `Registration for ${existing.name} was rejected. Reason: ${parsed.data.reason}`,
        entityType: "Supplier",
        entityId: existing.id,
      });
    }
  });

  return { id: existing.id, status: "REJECTED" as const, already: false };
}
