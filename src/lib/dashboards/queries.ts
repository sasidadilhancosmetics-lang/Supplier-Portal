import "server-only";

import { requireAdmin, requireStaffAreaPage, requireSupplier } from "@/lib/auth/guards";
import { canStaffPermission } from "@/lib/auth/guards";
import { formatCalendarDate, formatDateTime } from "@/lib/dates";
import { prisma } from "@/lib/db";
import { loadSupplierResponseDashboard } from "@/lib/dashboards/supplier-responses";
import {
  buildSupplierAvailabilityOrderStats,
  mapSupplierRecentOrderRows,
} from "@/lib/dashboards/supplier-recent-orders";
import { listPurchaseOrdersForSupplier } from "@/lib/orders/queries";
import { loadSupplierActionRequired } from "@/lib/supplier/action-required";

const RECENT_LIMIT = 5;
const NEAR_DEADLINE_DAYS = 3;

function nearDeadlineCutoff() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + NEAR_DEADLINE_DAYS);
  return d;
}

export type DashboardAlert = {
  id: string;
  tone: "warning" | "info";
  title: string;
  detail: string;
  href?: string;
};

export type DashboardStat = {
  id: string;
  label: string;
  value: number | string;
  href?: string;
  hint?: string;
};

export type DashboardQuickAction = {
  id: string;
  label: string;
  href: string;
  primary?: boolean;
};

export type DashboardRecentRow = {
  id: string;
  title: string;
  meta: string;
  href: string;
};

/** ADMIN company overview — session company only. */
export async function getAdminDashboard() {
  const user = await requireAdmin();
  const companyId = user.companyId;

  const [
    pendingReviewSuppliers,
    activeSuppliers,
    inactiveSuppliers,
    osfNeedsReview,
    osfReadyToConfirm,
    draftRequirements,
    awaitingPoConfirm,
    submittedDeliveries,
    recentAudit,
    recentPendingSuppliers,
    supplierResponses,
  ] = await Promise.all([
    prisma.supplier.count({
      where: { companyId, status: "PENDING_REVIEW" },
    }),
    prisma.supplier.count({ where: { companyId, status: "ACTIVE" } }),
    prisma.supplier.count({
      where: { companyId, status: { in: ["INACTIVE", "REJECTED"] } },
    }),
    prisma.osfImport.count({
      where: {
        companyId,
        status: { in: ["NEEDS_REVIEW", "RECEIVED", "PROCESSED"] },
      },
    }),
    prisma.osfImport.count({
      where: { companyId, status: "READY_TO_CONFIRM" },
    }),
    prisma.requirement.count({
      where: { companyId, status: "DRAFT" },
    }),
    prisma.purchaseOrder.count({
      where: { companyId, status: "SENT" },
    }),
    prisma.delivery.count({
      where: { companyId, status: { in: ["SUBMITTED", "SCHEDULED"] } },
    }),
    prisma.user
      .findMany({
        where: { companyId },
        select: { id: true },
      })
      .then((users) =>
        prisma.auditLog.findMany({
          where: { actorUserId: { in: users.map((u) => u.id) } },
          orderBy: { createdAt: "desc" },
          take: RECENT_LIMIT,
          select: {
            id: true,
            action: true,
            entityType: true,
            entityId: true,
            createdAt: true,
          },
        }),
      ),
    prisma.supplier.findMany({
      where: { companyId, status: "PENDING_REVIEW" },
      orderBy: { createdAt: "desc" },
      take: RECENT_LIMIT,
      select: { id: true, name: true, createdAt: true },
    }),
    loadSupplierResponseDashboard(companyId),
  ]);

  const openRequests = supplierResponses.summary.awaitingResponses;

  const alerts: DashboardAlert[] = [];
  if (pendingReviewSuppliers > 0) {
    alerts.push({
      id: "pending-suppliers",
      tone: "warning",
      title: "Suppliers awaiting activation",
      detail: `${pendingReviewSuppliers} registration${pendingReviewSuppliers === 1 ? "" : "s"} pending review.`,
      href: "/admin/suppliers?status=PENDING_REVIEW",
    });
  }
  if (osfNeedsReview + osfReadyToConfirm > 0) {
    alerts.push({
      id: "osf-imports",
      tone: "warning",
      title: "OSF imports need attention",
      detail: `${osfNeedsReview} in review · ${osfReadyToConfirm} ready to confirm.`,
      href: "/staff/osf-imports",
    });
  }
  if (openRequests > 0) {
    alerts.push({
      id: "open-requests",
      tone: "info",
      title: "Awaiting supplier responses",
      detail: `${openRequests} request${openRequests === 1 ? "" : "s"} still waiting on supplier response.`,
      href: "/staff/requests",
    });
  }
  if (supplierResponses.summary.responsesReceived > 0) {
    alerts.push({
      id: "responses-received",
      tone: "info",
      title: "Supplier responses received",
      detail: `${supplierResponses.summary.responsesReceived} fully responded request${supplierResponses.summary.responsesReceived === 1 ? "" : "s"} — review prices or allocate.`,
      href: "/staff/requests?status=RESPONDED",
    });
  }
  if (supplierResponses.priceActions.counts.confirmedForReview > 0) {
    const itemCount =
      supplierResponses.priceActions.counts.confirmedForReview;
    const readyItems =
      supplierResponses.priceActions.counts.readyForAllocation;
    const readyRequests =
      supplierResponses.summary.readyForAllocation;
    alerts.push({
      id: "confirmed-prices",
      tone: "warning",
      title: "Supplier-confirmed prices need review",
      detail: `${itemCount} offer${itemCount === 1 ? "" : "s"} with uncovered plan · ${readyItems} item${readyItems === 1 ? "" : "s"} ready · ${readyRequests} request${readyRequests === 1 ? "" : "s"} ready for allocation.`,
      href: "/staff/requests?status=RESPONDED",
    });
  }
  if (supplierResponses.priceActions.counts.revisedAwaitingDecision > 0) {
    alerts.push({
      id: "revised-prices",
      tone: "warning",
      title: "Revised supplier prices await decision",
      detail: `${supplierResponses.priceActions.counts.revisedAwaitingDecision} revised offer${supplierResponses.priceActions.counts.revisedAwaitingDecision === 1 ? "" : "s"} need staff review.`,
      href: "/staff/requests?status=RESPONDED",
    });
  }
  if (submittedDeliveries > 0) {
    alerts.push({
      id: "deliveries",
      tone: "warning",
      title: "Deliveries awaiting verification",
      detail: `${submittedDeliveries} submitted delivery${submittedDeliveries === 1 ? "" : "ies"} need verification.`,
      href: "/staff/deliveries",
    });
  }

  const stats: DashboardStat[] = [
    {
      id: "pending-approvals",
      label: "Pending approvals",
      value: pendingReviewSuppliers,
      href: "/admin/suppliers?status=PENDING_REVIEW",
    },
    {
      id: "active-suppliers",
      label: "Active suppliers",
      value: activeSuppliers,
      href: "/admin/suppliers?status=ACTIVE",
    },
    {
      id: "osf-open",
      label: "Open OSF imports",
      value: osfNeedsReview + osfReadyToConfirm,
      href: "/staff/osf-imports",
    },
    {
      id: "draft-requirements",
      label: "Draft requirements",
      value: draftRequirements,
      href: "/staff/requirements?status=DRAFT",
    },
    {
      id: "open-requests",
      label: "Awaiting Supplier Responses",
      value: openRequests,
      href: "/staff/requests",
      hint: "Requests still NEW or partially responded",
    },
    {
      id: "responses-received",
      label: "Responses received",
      value: supplierResponses.summary.responsesReceived,
      href: "/staff/requests?status=RESPONDED",
    },
    {
      id: "price-review",
      label: "Needing price review (requests)",
      value: supplierResponses.summary.needingPriceReview,
      href: "/staff/requests?status=RESPONDED",
      hint: "Requests with unconfirmed supplier prices",
    },
    {
      id: "ready-allocate",
      label: "Ready for allocation (requests)",
      value: supplierResponses.summary.readyForAllocation,
      href: "/staff/requests?status=RESPONDED",
      hint: "Requests with agreed price, live reserve, and uncovered plan",
    },
    {
      id: "pos-awaiting",
      label: "POs awaiting confirm",
      value: awaitingPoConfirm,
      href: "/staff/orders?status=AWAITING_CONFIRMATION",
    },
    {
      id: "deliveries-pending",
      label: "Pending delivery verifications",
      value: submittedDeliveries,
      href: "/staff/deliveries",
    },
  ];

  const quickActions: DashboardQuickAction[] = [
    {
      id: "suppliers",
      label: "Manage suppliers",
      href: "/admin/suppliers",
      primary: true,
    },
    { id: "add-supplier", label: "Add supplier", href: "/admin/suppliers/new" },
    { id: "osf", label: "Review OSF imports", href: "/staff/osf-imports" },
    {
      id: "requirements",
      label: "Requirements",
      href: "/staff/requirements",
    },
    { id: "requests", label: "Supplier requests", href: "/staff/requests" },
    {
      id: "deliveries",
      label: "Verify deliveries",
      href: "/staff/deliveries",
    },
  ];

  const pendingApprovals: DashboardRecentRow[] = recentPendingSuppliers.map(
    (s) => ({
      id: s.id,
      title: s.name,
      meta: `Submitted ${formatDateTime(s.createdAt)}`,
      href: `/admin/suppliers/${s.id}`,
    }),
  );

  const recentActivity: DashboardRecentRow[] = recentAudit.map((row) => ({
    id: row.id,
    title: `${row.entityType}: ${row.action}`,
    meta: formatDateTime(row.createdAt),
    href:
      row.entityType === "Supplier"
        ? `/admin/suppliers/${row.entityId}`
        : row.entityType === "OsfImport"
          ? `/staff/osf-imports/${row.entityId}`
          : row.entityType === "Requirement"
            ? `/staff/requirements/${row.entityId}`
            : row.entityType === "SupplierRequest"
              ? `/staff/requests/${row.entityId}`
              : row.entityType === "Delivery"
                ? `/staff/deliveries/${row.entityId}`
                : "/admin",
  }));

  return {
    alerts,
    stats,
    quickActions,
    pendingApprovals,
    recentActivity,
    supplierResponses: supplierResponses.recentResponses,
    responseSummary: supplierResponses.summary,
    priceActions: supplierResponses.priceActions,
    supplierOverview: {
      active: activeSuppliers,
      pendingReview: pendingReviewSuppliers,
      inactiveOrRejected: inactiveSuppliers,
    },
    unavailable: {
      reports: "Reports UI is not available yet.",
      staffManagement: "Staff permission management UI is not available yet.",
    } as const,
  };
}

/** STAFF / ADMIN staff-area dashboard. */
export async function getStaffDashboard() {
  const user = await requireStaffAreaPage();
  const companyId = user.companyId;
  const isAdmin = user.role === "ADMIN";

  const canProducts =
    isAdmin || (await canStaffPermission("MANAGE_PRODUCTS"));
  const canRequests =
    isAdmin || (await canStaffPermission("SEND_SUPPLIER_REQUEST"));
  const canOrders = isAdmin || (await canStaffPermission("ALLOCATE_ORDER"));
  const canDeliveries =
    isAdmin || (await canStaffPermission("VERIFY_DELIVERY"));
  const canRequirements =
    isAdmin ||
    (await canStaffPermission("MANAGE_REQUIREMENTS")) ||
    (await canStaffPermission("CONFIRM_REQUIREMENT")) ||
    canRequests;

  const deadline = nearDeadlineCutoff();
  const now = new Date();

  const [
    osfNeedsAttention,
    draftRequirements,
    confirmedRequirements,
    nearDeadlineRequests,
    awaitingPoConfirm,
    submittedDeliveries,
    recentImports,
    supplierResponses,
  ] = await Promise.all([
    canRequirements
      ? prisma.osfImport.count({
          where: {
            companyId,
            status: {
              in: ["NEEDS_REVIEW", "RECEIVED", "PROCESSED", "READY_TO_CONFIRM"],
            },
          },
        })
      : Promise.resolve(0),
    canRequirements
      ? prisma.requirement.count({
          where: { companyId, status: "DRAFT" },
        })
      : Promise.resolve(0),
    canRequirements
      ? prisma.requirement.count({
          where: { companyId, status: "CONFIRMED" },
        })
      : Promise.resolve(0),
    canRequests
      ? prisma.supplierRequest.count({
          where: {
            companyId,
            status: { in: ["NEW", "PARTIALLY_RESPONDED"] },
            responseDeadline: { not: null, lte: deadline, gt: now },
          },
        })
      : Promise.resolve(0),
    canOrders
      ? prisma.purchaseOrder.count({
          where: { companyId, status: "SENT" },
        })
      : Promise.resolve(0),
    canDeliveries
      ? prisma.delivery.count({
          where: { companyId, status: { in: ["SUBMITTED", "SCHEDULED"] } },
        })
      : Promise.resolve(0),
    canRequirements
      ? prisma.osfImport.findMany({
          where: {
            companyId,
            status: {
              in: ["NEEDS_REVIEW", "RECEIVED", "PROCESSED", "READY_TO_CONFIRM"],
            },
          },
          orderBy: { receivedAt: "desc" },
          take: RECENT_LIMIT,
          select: {
            id: true,
            status: true,
            receivedAt: true,
            _count: { select: { lines: true } },
          },
        })
      : Promise.resolve([]),
    canRequests
      ? loadSupplierResponseDashboard(companyId)
      : Promise.resolve({
          summary: {
            awaitingResponses: 0,
            responsesReceived: 0,
            needingPriceReview: 0,
            readyForAllocation: 0,
          },
          recentResponses: [],
          priceActions: {
            confirmedForReview: [],
            revisedAwaitingDecision: [],
            counts: {
              confirmedForReview: 0,
              revisedAwaitingDecision: 0,
              readyForAllocation: 0,
            },
          },
        }),
  ]);

  const awaitingResponses = supplierResponses.summary.awaitingResponses;

  const alerts: DashboardAlert[] = [];
  if (osfNeedsAttention > 0) {
    alerts.push({
      id: "osf",
      tone: "warning",
      title: "OSF imports need review",
      detail: `${osfNeedsAttention} import${osfNeedsAttention === 1 ? "" : "s"} not confirmed yet.`,
      href: "/staff/osf-imports",
    });
  }
  if (nearDeadlineRequests > 0) {
    alerts.push({
      id: "deadline",
      tone: "warning",
      title: "Responses due soon",
      detail: `${nearDeadlineRequests} open request${nearDeadlineRequests === 1 ? "" : "s"} with deadline in the next ${NEAR_DEADLINE_DAYS} days.`,
      href: "/staff/requests",
    });
  }
  if (submittedDeliveries > 0) {
    alerts.push({
      id: "deliveries",
      tone: "warning",
      title: "Deliveries awaiting verification",
      detail: `${submittedDeliveries} submitted delivery${submittedDeliveries === 1 ? "" : "ies"} need verification.`,
      href: "/staff/deliveries",
    });
  }
  if (supplierResponses.priceActions.counts.confirmedForReview > 0) {
    const itemCount =
      supplierResponses.priceActions.counts.confirmedForReview;
    const readyItems =
      supplierResponses.priceActions.counts.readyForAllocation;
    const readyRequests =
      supplierResponses.summary.readyForAllocation;
    alerts.push({
      id: "confirmed-prices",
      tone: "warning",
      title: "Supplier-confirmed prices need review",
      detail: `${itemCount} offer${itemCount === 1 ? "" : "s"} with uncovered plan · ${readyItems} item${readyItems === 1 ? "" : "s"} ready · ${readyRequests} request${readyRequests === 1 ? "" : "s"} ready for allocation.`,
      href: "/staff/requests?status=RESPONDED",
    });
  }
  if (supplierResponses.priceActions.counts.revisedAwaitingDecision > 0) {
    alerts.push({
      id: "revised-prices",
      tone: "warning",
      title: "Revised supplier prices await decision",
      detail: `${supplierResponses.priceActions.counts.revisedAwaitingDecision} revised offer${supplierResponses.priceActions.counts.revisedAwaitingDecision === 1 ? "" : "s"} need review.`,
      href: "/staff/requests?status=RESPONDED",
    });
  }

  const stats: DashboardStat[] = [];
  if (canRequirements) {
    stats.push(
      {
        id: "osf",
        label: "OSF needing attention",
        value: osfNeedsAttention,
        href: "/staff/osf-imports",
      },
      {
        id: "draft-req",
        label: "Draft requirements",
        value: draftRequirements,
        href: "/staff/requirements?status=DRAFT",
      },
      {
        id: "confirmed-req",
        label: "Confirmed requirements",
        value: confirmedRequirements,
        href: "/staff/requirements?status=CONFIRMED",
      },
    );
  }
  if (canRequests) {
    stats.push(
      {
        id: "awaiting",
        label: "Awaiting Supplier Responses",
        value: awaitingResponses,
        href: "/staff/requests",
        hint: "NEW or partially responded",
      },
      {
        id: "responded",
        label: "Responses received",
        value: supplierResponses.summary.responsesReceived,
        href: "/staff/requests?status=RESPONDED",
      },
      {
        id: "price-review",
        label: "Needing price review (requests)",
        value: supplierResponses.summary.needingPriceReview,
        href: "/staff/requests?status=RESPONDED",
        hint: "Requests with unconfirmed supplier prices",
      },
      {
        id: "ready-allocate",
        label: "Ready for allocation (requests)",
        value: supplierResponses.summary.readyForAllocation,
        href: "/staff/requests?status=RESPONDED",
        hint: "Agreed price, live reserve, and uncovered plan",
      },
    );
  }
  if (canOrders) {
    stats.push({
      id: "po-sent",
      label: "POs awaiting supplier confirm",
      value: awaitingPoConfirm,
      href: "/staff/orders?status=AWAITING_CONFIRMATION",
    });
  }
  if (canDeliveries) {
    stats.push({
      id: "deliveries-pending",
      label: "Pending delivery verifications",
      value: submittedDeliveries,
      href: "/staff/deliveries",
      hint: "Supplier submissions awaiting received qty",
    });
  }

  const quickActions: DashboardQuickAction[] = [];
  if (canRequirements) {
    quickActions.push({
      id: "osf",
      label: "OSF Import Review",
      href: "/staff/osf-imports",
      primary: true,
    });
    quickActions.push({
      id: "requirements",
      label: "Requirements",
      href: "/staff/requirements",
    });
  }
  if (canProducts) {
    quickActions.push({
      id: "products",
      label: "Products",
      href: "/staff/products",
    });
  }
  if (canRequests) {
    quickActions.push({
      id: "requests",
      label: "Supplier requests",
      href: "/staff/requests",
    });
  }
  if (canOrders) {
    quickActions.push({
      id: "orders",
      label: "Purchase orders",
      href: "/staff/orders",
    });
  }
  if (canDeliveries) {
    quickActions.push({
      id: "deliveries",
      label: "Verify deliveries",
      href: "/staff/deliveries",
      primary: submittedDeliveries > 0,
    });
  }

  const recentOsf: DashboardRecentRow[] = recentImports.map((row) => ({
    id: row.id,
    title: `Import ${row.id.slice(0, 8)}… · ${row.status}`,
    meta: `${row._count.lines} lines · ${formatDateTime(row.receivedAt)}`,
    href: `/staff/osf-imports/${row.id}`,
  }));

  return {
    alerts,
    stats,
    quickActions,
    recentOsf,
    canRequests,
    supplierResponses: supplierResponses.recentResponses,
    responseSummary: supplierResponses.summary,
    priceActions: supplierResponses.priceActions,
    unavailable: {
      performance: "Supplier performance scoring is not available yet.",
      reports: "Reports UI is not available yet.",
      shortages:
        "Outstanding shortage analytics are not available as a dedicated view yet — use requirements and orders coverage.",
    } as const,
  };
}

/** SUPPLIER dashboard — session supplier only. */
export async function getSupplierDashboard() {
  const user = await requireSupplier();
  const companyId = user.companyId;
  const supplierId = user.supplierId!;
  const now = new Date();
  const startOfToday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );

  const [
    openRequests,
    responded,
    ordersAwaitingConfirm,
    confirmedOrders,
    scheduledUpcoming,
    recentOrderList,
    unreadNotifications,
    actionRequired,
  ] = await Promise.all([
    prisma.supplierRequest.count({
      where: {
        companyId,
        supplierId,
        status: { in: ["NEW", "PARTIALLY_RESPONDED"] },
      },
    }),
    prisma.supplierRequest.count({
      where: { companyId, supplierId, status: "RESPONDED" },
    }),
    // Actionable only — SENT. Delivered must not inflate this.
    prisma.purchaseOrder.count({
      where: { companyId, supplierId, status: "SENT" },
    }),
    // Actionable open delivery only — excludes DELIVERED / CANCELLED.
    prisma.purchaseOrder.count({
      where: {
        companyId,
        supplierId,
        status: { in: ["CONFIRMED", "PARTIALLY_DELIVERED"] },
      },
    }),
    prisma.delivery.findMany({
      where: {
        companyId,
        supplierId,
        status: "SCHEDULED",
        plannedDeliveryAt: { not: null, gte: startOfToday },
      },
      orderBy: { plannedDeliveryAt: "asc" },
      take: RECENT_LIMIT,
      include: {
        purchaseOrder: { select: { id: true, orderNumber: true } },
        items: {
          select: { quantityDelivered: true },
        },
      },
    }),
    // Same supplier/company scope + status set as /supplier/orders (includes DELIVERED).
    listPurchaseOrdersForSupplier({ page: 1 }),
    prisma.notification.count({
      where: { userId: user.id, status: "UNREAD" },
    }),
    loadSupplierActionRequired(),
  ]);

  // Attention panel owns actionable alerts — keep this empty to avoid duplicates.
  const alerts: DashboardAlert[] = [];

  const stats = buildSupplierAvailabilityOrderStats({
    openRequests,
    responded,
    ordersAwaitingConfirm,
    confirmedInDelivery: confirmedOrders,
    unreadNotifications,
  });

  const quickActions: DashboardQuickAction[] = [
    {
      id: "requests",
      label: "Availability requests",
      href: "/supplier/requests",
      primary: true,
    },
    { id: "orders", label: "Orders", href: "/supplier/orders" },
    {
      id: "deliveries",
      label: "Deliveries",
      href: "/supplier/deliveries",
    },
    {
      id: "notifications",
      label: "Notifications",
      href: "/supplier/notifications",
    },
  ];

  const upcomingDeliveries: DashboardRecentRow[] = scheduledUpcoming.map(
    (d) => {
      const qty = d.items.reduce(
        (sum, item) => sum + Number(item.quantityDelivered),
        0,
      );
      return {
        id: d.id,
        title: d.purchaseOrder.orderNumber ?? d.purchaseOrder.id,
        meta: `Planned ${formatCalendarDate(d.plannedDeliveryAt)}${
          qty > 0 ? ` · qty ${qty}` : ""
        }`,
        href: `/supplier/orders/${d.purchaseOrder.id}/deliver`,
      };
    },
  );

  const recentOrderRows = mapSupplierRecentOrderRows(
    recentOrderList.items.slice(0, RECENT_LIMIT).map((po) => ({
      id: po.id,
      orderNumber: po.orderNumber,
      status: po.status,
      itemCount: po.itemCount,
      createdAt: po.createdAt,
    })),
  );

  return {
    alerts,
    stats,
    quickActions,
    upcomingDeliveries,
    recentOrders: recentOrderRows,
    actionRequired,
    unreadNotifications,
    unavailable: {
      performance: "Supplier performance score is not available yet.",
    } as const,
  };
}
