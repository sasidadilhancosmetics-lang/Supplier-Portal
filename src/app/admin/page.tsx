import type { Metadata } from "next";

import {
  DashboardAlerts,
  DashboardHeader,
  DashboardPriceActions,
  DashboardQuickActions,
  DashboardRecentList,
  DashboardSection,
  DashboardStats,
  DashboardSupplierResponses,
  DashboardUnavailable,
} from "@/components/dashboard/dashboard-sections";
import { getAdminDashboard } from "@/lib/dashboards/queries";
import { getPortalArea } from "@/lib/portal-areas";

const area = getPortalArea("/admin");

export const metadata: Metadata = {
  title: "Admin dashboard",
  description: area.purpose,
};

export const instant = false;

export default async function AdminHomePage() {
  const data = await getAdminDashboard();

  return (
    <div className="flex flex-col gap-8">
      <DashboardHeader
        title="Admin dashboard"
        description="Company overview for supplier activation, OSF imports, and purchasing workflows."
      />

      <DashboardSection title="Needs attention">
        <DashboardAlerts alerts={data.alerts} />
      </DashboardSection>

      <DashboardSection title="Summary">
        <DashboardStats stats={data.stats} />
      </DashboardSection>

      <DashboardSection title="Quick actions">
        <DashboardQuickActions actions={data.quickActions} />
      </DashboardSection>

      <DashboardSection title="Price confirmation & review">
        <DashboardPriceActions
          confirmed={data.priceActions.confirmedForReview}
          revised={data.priceActions.revisedAwaitingDecision}
        />
      </DashboardSection>

      <DashboardSupplierResponses rows={data.supplierResponses} />

      <div className="grid gap-4 lg:grid-cols-2">
        <DashboardRecentList
          title="Pending approvals"
          empty="No suppliers waiting for activation."
          rows={data.pendingApprovals}
        />
        <DashboardRecentList
          title="Recent activity"
          empty="No recent company audit activity."
          rows={data.recentActivity}
        />
      </div>

      <DashboardSection title="Supplier overview">
        <DashboardStats
          stats={[
            {
              id: "ov-active",
              label: "Active",
              value: data.supplierOverview.active,
              href: "/admin/suppliers?status=ACTIVE",
            },
            {
              id: "ov-pending",
              label: "Pending review",
              value: data.supplierOverview.pendingReview,
              href: "/admin/suppliers?status=PENDING_REVIEW",
            },
            {
              id: "ov-inactive",
              label: "Inactive / rejected",
              value: data.supplierOverview.inactiveOrRejected,
              href: "/admin/suppliers",
            },
          ]}
        />
      </DashboardSection>

      <DashboardUnavailable items={data.unavailable} />
    </div>
  );
}
