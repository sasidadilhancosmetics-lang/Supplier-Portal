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
import { getStaffDashboard } from "@/lib/dashboards/queries";
import { getPortalArea } from "@/lib/portal-areas";

const area = getPortalArea("/staff");

export const metadata: Metadata = {
  title: "Staff dashboard",
  description: area.purpose,
};

export const instant = false;

export default async function StaffHomePage() {
  const data = await getStaffDashboard();

  return (
    <div className="flex flex-col gap-8">
      <DashboardHeader
        title="Staff dashboard"
        description="OSF imports, requirements, supplier responses, and purchase orders for your company."
      />

      <DashboardSection title="Alerts">
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

      {data.canRequests ? (
        <DashboardSupplierResponses rows={data.supplierResponses} />
      ) : null}

      <DashboardRecentList
        title="OSF imports needing attention"
        empty="No open OSF imports."
        rows={data.recentOsf}
      />

      <DashboardUnavailable items={data.unavailable} />
    </div>
  );
}
