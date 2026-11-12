import "server-only";

import { AuthorizationError } from "@/lib/auth/errors";
import { requireAdmin } from "@/lib/auth/guards";
import { resolveAuth0Issuer } from "@/lib/auth/issuer";
import { getAuth0Session } from "@/lib/auth/auth0-session";
import { prisma } from "@/lib/db";
import { createId } from "@/lib/id";
import { writeSupplierAuditLog } from "@/lib/suppliers/audit";

import {
  generateInviteToken,
  hashInviteToken,
  inviteExpiresAt,
  normalizeEmail,
} from "./crypto";
import { InvitationError } from "./errors";
import { buildInviteAcceptPath } from "./redirects";
import { emailsMatchForInvite, invitationEffectiveStatus } from "./rules";

const AUTH0_PROVIDER = "auth0";

function resolveIssuer(sessionUser: Record<string, unknown>): string {
  const issuer = resolveAuth0Issuer(sessionUser);
  if (!issuer) {
    throw new InvitationError("VALIDATION", "Auth0 issuer is unavailable.");
  }
  return issuer;
}

export async function listSupplierUsersForAdmin(supplierId: string) {
  const admin = await requireAdmin();

  const supplier = await prisma.supplier.findFirst({
    where: { id: supplierId, companyId: admin.companyId },
    select: { id: true },
  });
  if (!supplier) {
    throw new InvitationError("NOT_FOUND", "Supplier not found.");
  }

  const [users, invitations] = await Promise.all([
    prisma.user.findMany({
      where: {
        companyId: admin.companyId,
        supplierId,
        role: "SUPPLIER",
      },
      orderBy: [{ email: "asc" }],
      select: {
        id: true,
        email: true,
        name: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        externalIdentities: {
          select: { id: true, provider: true, lastLoginAt: true },
          take: 1,
        },
      },
    }),
    prisma.supplierInvitation.findMany({
      where: { companyId: admin.companyId, supplierId },
      orderBy: [{ createdAt: "desc" }],
      select: {
        id: true,
        invitedEmail: true,
        status: true,
        expiresAt: true,
        createdAt: true,
        acceptedAt: true,
        revokedAt: true,
      },
    }),
  ]);

  return {
    users: users.map((user) => ({
      id: user.id,
      email: user.email,
      name: user.name,
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      linked: user.externalIdentities.length > 0,
    })),
    invitations: invitations.map((invite) => ({
      id: invite.id,
      invitedEmail: invite.invitedEmail,
      status: invitationEffectiveStatus({
        status: invite.status,
        expiresAt: invite.expiresAt,
      }),
      expiresAt: invite.expiresAt,
      createdAt: invite.createdAt,
      acceptedAt: invite.acceptedAt,
      revokedAt: invite.revokedAt,
    })),
  };
}

/**
 * Creates a PENDING invitation. Returns plaintext accept URL once for
 * development/no-email flows. Never log the token.
 */
export async function createSupplierInvitation(args: {
  supplierId: string;
  email: string;
}) {
  const admin = await requireAdmin();
  const email = normalizeEmail(args.email);
  if (!email || !email.includes("@")) {
    throw new InvitationError("VALIDATION", "Enter a valid email address.");
  }

  const supplier = await prisma.supplier.findFirst({
    where: { id: args.supplierId, companyId: admin.companyId },
    select: { id: true, companyId: true, name: true },
  });
  if (!supplier) {
    throw new InvitationError("NOT_FOUND", "Supplier not found.");
  }

  const existingUser = await prisma.user.findUnique({
    where: { email },
    select: { id: true, role: true, supplierId: true, companyId: true },
  });
  if (existingUser) {
    if (
      existingUser.role !== "SUPPLIER" ||
      existingUser.companyId !== admin.companyId ||
      existingUser.supplierId !== supplier.id
    ) {
      throw new InvitationError(
        "USER_CONFLICT",
        "That email is already linked to a different account.",
      );
    }
  }

  const pending = await prisma.supplierInvitation.findFirst({
    where: {
      companyId: admin.companyId,
      supplierId: supplier.id,
      invitedEmail: email,
      status: "PENDING",
      expiresAt: { gt: new Date() },
    },
    select: { id: true },
  });
  if (pending) {
    throw new InvitationError(
      "DUPLICATE_PENDING",
      "An active invitation already exists for this email.",
    );
  }

  const token = generateInviteToken();
  const tokenHash = hashInviteToken(token);
  const expiresAt = inviteExpiresAt();

  const invitation = await prisma.$transaction(async (tx) => {
    const created = await tx.supplierInvitation.create({
      data: {
        id: createId(),
        companyId: supplier.companyId,
        supplierId: supplier.id,
        invitedEmail: email,
        role: "SUPPLIER",
        tokenHash,
        status: "PENDING",
        expiresAt,
        invitedByUserId: admin.id,
      },
    });

    await writeSupplierAuditLog({
      tx,
      actorUserId: admin.id,
      entityId: supplier.id,
      action: "UPDATE",
      afterJson: {
        invitationId: created.id,
        invitedEmail: email,
        event: "INVITE_CREATED",
        expiresAt: expiresAt.toISOString(),
      },
    });

    return created;
  });

  const appBase = (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  );
  const acceptPath = buildInviteAcceptPath(token);

  return {
    invitationId: invitation.id,
    expiresAt,
    /** One-time plaintext URL for admin copy in no-email development mode. */
    acceptUrl: `${appBase}${acceptPath}`,
  };
}

export async function revokeSupplierInvitation(invitationId: string) {
  const admin = await requireAdmin();

  const invitation = await prisma.supplierInvitation.findFirst({
    where: { id: invitationId, companyId: admin.companyId },
  });
  if (!invitation) {
    throw new InvitationError("NOT_FOUND", "Invitation not found.");
  }
  if (invitation.status !== "PENDING") {
    throw new InvitationError(
      "VALIDATION",
      "Only pending invitations can be revoked.",
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.supplierInvitation.update({
      where: { id: invitation.id },
      data: {
        status: "REVOKED",
        revokedAt: new Date(),
        revokedByUserId: admin.id,
      },
    });
    await writeSupplierAuditLog({
      tx,
      actorUserId: admin.id,
      entityId: invitation.supplierId,
      action: "UPDATE",
      afterJson: {
        invitationId: invitation.id,
        event: "INVITE_REVOKED",
      },
    });
  });

  return { id: invitation.id };
}

export async function setSupplierUserActive(args: {
  userId: string;
  supplierId: string;
  isActive: boolean;
}) {
  const admin = await requireAdmin();

  const user = await prisma.user.findFirst({
    where: {
      id: args.userId,
      companyId: admin.companyId,
      supplierId: args.supplierId,
      role: "SUPPLIER",
    },
  });
  if (!user) {
    throw new InvitationError("NOT_FOUND", "User not found.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { isActive: args.isActive },
    });
    await writeSupplierAuditLog({
      tx,
      actorUserId: admin.id,
      entityId: args.supplierId,
      action: "UPDATE",
      beforeJson: { userId: user.id, isActive: user.isActive },
      afterJson: {
        userId: user.id,
        isActive: args.isActive,
        event: args.isActive ? "USER_ENABLED" : "USER_DISABLED",
      },
    });
  });

  return { id: user.id, isActive: args.isActive };
}

/**
 * Accept invite for the currently authenticated Auth0 session.
 * Links ExternalIdentity using exact issuer+subject — never email alone.
 */
export async function acceptSupplierInvitation(rawToken: string) {
  if (!rawToken || rawToken.length < 16) {
    throw new InvitationError("VALIDATION", "Invitation token is invalid.");
  }

  // Must have Auth0 session (may be pending/unprovisioned).
  let session;
  try {
    session = await getAuth0Session();
  } catch {
    throw new AuthorizationError("UNAUTHENTICATED");
  }
  if (!session?.user?.sub) {
    throw new AuthorizationError("UNAUTHENTICATED");
  }

  const authEmail =
    typeof session.user.email === "string" ? session.user.email : null;
  const emailVerified = session.user.email_verified === true;
  if (!emailVerified) {
    throw new InvitationError(
      "EMAIL_UNVERIFIED",
      "Verify your email with Auth0 before accepting this invitation.",
    );
  }

  const tokenHash = hashInviteToken(rawToken);
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const invitation = await tx.supplierInvitation.findUnique({
      where: { tokenHash },
    });

    if (!invitation) {
      throw new InvitationError("NOT_FOUND", "Invitation not found.");
    }

    const effective = invitationEffectiveStatus({
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      now,
    });

    if (effective === "REVOKED") {
      throw new InvitationError("REVOKED", "This invitation was revoked.");
    }
    if (effective === "EXPIRED") {
      throw new InvitationError("EXPIRED", "This invitation has expired.");
    }

    if (invitation.status === "ACCEPTED") {
      // Idempotent: same Auth0 identity already linked to accepted user.
      if (invitation.acceptedUserId) {
        const existingLink = await tx.externalIdentity.findFirst({
          where: {
            userId: invitation.acceptedUserId,
            provider: AUTH0_PROVIDER,
            providerSubject: session.user.sub,
          },
        });
        if (existingLink) {
          return { userId: invitation.acceptedUserId, alreadyAccepted: true };
        }
      }
      throw new InvitationError(
        "ALREADY_ACCEPTED",
        "This invitation was already accepted.",
      );
    }

    if (invitation.role !== "SUPPLIER") {
      throw new InvitationError(
        "INVALID_ROLE",
        "Invitation role is not allowed.",
      );
    }

    if (!emailsMatchForInvite(invitation.invitedEmail, authEmail)) {
      throw new InvitationError(
        "EMAIL_MISMATCH",
        "Sign in with the invited email address to accept this invitation.",
      );
    }

    const issuer = resolveIssuer(session.user as Record<string, unknown>);

    const existingIdentity = await tx.externalIdentity.findUnique({
      where: {
        provider_providerIssuer_providerSubject: {
          provider: AUTH0_PROVIDER,
          providerIssuer: issuer,
          providerSubject: session.user.sub,
        },
      },
      include: { user: true },
    });

    if (
      existingIdentity &&
      (existingIdentity.user.role !== "SUPPLIER" ||
        existingIdentity.user.supplierId !== invitation.supplierId)
    ) {
      throw new InvitationError(
        "IDENTITY_IN_USE",
        "This Auth0 account is already linked to a different portal user.",
      );
    }

    let userId = existingIdentity?.userId ?? null;

    if (!userId) {
      const byEmail = await tx.user.findUnique({
        where: { email: invitation.invitedEmail },
      });

      if (byEmail) {
        if (
          byEmail.role !== "SUPPLIER" ||
          byEmail.companyId !== invitation.companyId ||
          byEmail.supplierId !== invitation.supplierId
        ) {
          throw new InvitationError(
            "USER_CONFLICT",
            "That email is already linked to a different account.",
          );
        }
        userId = byEmail.id;
        if (!byEmail.isActive) {
          await tx.user.update({
            where: { id: byEmail.id },
            data: { isActive: true },
          });
        }
      } else {
        const name =
          typeof session.user.name === "string" ? session.user.name : null;
        const created = await tx.user.create({
          data: {
            id: createId(),
            companyId: invitation.companyId,
            supplierId: invitation.supplierId,
            role: "SUPPLIER",
            email: invitation.invitedEmail,
            name,
            isActive: true,
          },
        });
        userId = created.id;
      }
    }

    if (!existingIdentity) {
      await tx.externalIdentity.create({
        data: {
          id: createId(),
          userId,
          provider: AUTH0_PROVIDER,
          providerIssuer: issuer,
          providerSubject: session.user.sub,
          lastLoginAt: now,
        },
      });
    }

    const claimed = await tx.supplierInvitation.updateMany({
      where: {
        id: invitation.id,
        status: "PENDING",
        expiresAt: { gt: now },
      },
      data: {
        status: "ACCEPTED",
        acceptedAt: now,
        acceptedUserId: userId,
      },
    });

    if (claimed.count !== 1) {
      throw new InvitationError(
        "ALREADY_ACCEPTED",
        "This invitation was already accepted.",
      );
    }

    await writeSupplierAuditLog({
      tx,
      actorUserId: userId,
      entityId: invitation.supplierId,
      action: "UPDATE",
      afterJson: {
        invitationId: invitation.id,
        event: "INVITE_ACCEPTED",
        userId,
      },
    });

    return { userId, alreadyAccepted: false };
  });
}

/** Peek invite metadata for the accept page without consuming the token. */
export async function getInvitationPreview(rawToken: string) {
  if (!rawToken) {
    throw new InvitationError("VALIDATION", "Invitation token is missing.");
  }
  const tokenHash = hashInviteToken(rawToken);
  const invitation = await prisma.supplierInvitation.findUnique({
    where: { tokenHash },
    include: {
      supplier: { select: { name: true, status: true } },
    },
  });
  if (!invitation) {
    throw new InvitationError("NOT_FOUND", "Invitation not found.");
  }

  const status = invitationEffectiveStatus({
    status: invitation.status,
    expiresAt: invitation.expiresAt,
  });

  return {
    invitedEmail: invitation.invitedEmail,
    supplierName: invitation.supplier.name,
    supplierStatus: invitation.supplier.status,
    status,
    expiresAt: invitation.expiresAt,
  };
}

