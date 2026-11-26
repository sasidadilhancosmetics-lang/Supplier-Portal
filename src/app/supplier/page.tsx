import type { Metadata } from "next";

import {
  DashboardHeader,
  DashboardQuickActions,
  DashboardRecentList,
  DashboardSection,
  DashboardStats,
} from "@/components/dashboard/dashboard-sections";
import { ActionRequiredPanel } from "@/components/supplier/action-required-panel";
import { getSupplierDashboard } from "@/lib/dashboards/queries";
import { getPortalArea } from "@/lib/portal-areas";

const area = getPortalArea("/supplier");

export const metadata: Metadata = {
  title: "Supplier dashboard",
  description: area.purpose,
};

export const instant = false;

export default async function SupplierHomePage() {
  const data = await getSupplierDashboard();
  const attentionCount = data.actionRequired.counts.actionRequired;
  const hasUpcoming = data.upcomingDeliveries.length > 0;
  const hasRecentOrders = data.recentOrders.length > 0;
  const summaryStats = data.stats.filter((stat) => Number(stat.value) > 0);

  return (
    <div className="flex flex-col gap-6 sm:gap-8">
      <DashboardHeader
        title="Dashboard"
        description="See what needs a reply, then plan deliveries when you are ready."
      />

      {attentionCount > 0 ? (
        <DashboardSection title="Needs Your Attention">
          <ActionRequiredPanel
            pendingCounters={data.actionRequired.pendingCounters}
            pendingAvailability={data.actionRequired.pendingAvailability}
            pendingOrdersToConfirm={data.actionRequired.pendingOrdersToConfirm}
            ordersNeedingSchedule={data.actionRequired.ordersNeedingSchedule}
            approachingSchedules={data.actionRequired.approachingSchedules}
          />
        </DashboardSection>
      ) : (
        <div
          className="rounded-lg border border-border px-4 py-5"
          role="status"
        >
          <p className="font-medium">You&apos;re all caught up!</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Nothing needs your attention right now.
          </p>
        </div>
      )}

      {hasUpcoming ? (
        <DashboardRecentList
          title="Upcoming Deliveries"
          empty="No upcoming planned deliveries."
          rows={data.upcomingDeliveries}
          viewAllHref="/supplier/deliveries"
        />
      ) : null}

      {hasRecentOrders ? (
        <DashboardRecentList
          title="Recent Orders"
          empty="No purchase orders yet."
          rows={data.recentOrders}
          viewAllHref="/supplier/orders"
        />
      ) : null}

      {summaryStats.length > 0 ? (
        <DashboardSection title="Summary">
          <DashboardStats stats={summaryStats} density="compact" />
        </DashboardSection>
      ) : null}

      <DashboardSection title="Shortcuts">
        <DashboardQuickActions actions={data.quickActions} />
      </DashboardSection>
    </div>
  );
}
