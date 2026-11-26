import type { Metadata } from "next";
import Link from "next/link";

import {
  markAllCompanyNotificationsReadAction,
  markCompanyNotificationReadAction,
} from "@/app/staff/notifications/actions";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { listNotificationsForCurrentCompanyUser } from "@/lib/notifications";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Notifications",
  description: "Company in-app notifications for price and order events.",
};

export const instant = false;

export default async function CompanyNotificationsPage() {
  const rows = await listNotificationsForCurrentCompanyUser();
  const unreadCount = rows.filter((row) => row.status === "UNREAD").length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">
            Notifications
          </h1>
          <p className="text-base leading-7 text-muted-foreground">
            Supplier price confirmations, revisions, and order updates for your
            company.
          </p>
        </div>
        {unreadCount > 0 ? (
          <form action={markAllCompanyNotificationsReadAction}>
            <button
              type="submit"
              className={cn(
                buttonVariants({ variant: "outline", className: "min-h-11" }),
              )}
            >
              Mark all as read
            </button>
          </form>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No notifications yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => {
            const href =
              row.entityType === "AvailabilityOffer" && row.entityId
                ? `/staff/notifications/open?offerId=${encodeURIComponent(row.entityId)}&notificationId=${encodeURIComponent(row.id)}`
                : row.href;

            return (
              <li
                key={row.id}
                className={cn(
                  "rounded-lg border p-4",
                  row.status === "UNREAD" && "border-primary/40 bg-primary/5",
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{row.title}</p>
                      <Badge variant="outline">{row.status}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{row.body}</p>
                    <p className="text-xs text-muted-foreground">
                      {row.createdAtLabel}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={href}
                      className={cn(buttonVariants({ className: "min-h-11" }))}
                    >
                      Open
                    </Link>
                    {row.status === "UNREAD" ? (
                      <form action={markCompanyNotificationReadAction}>
                        <input
                          type="hidden"
                          name="notificationId"
                          value={row.id}
                        />
                        <button
                          type="submit"
                          className={cn(
                            buttonVariants({
                              variant: "outline",
                              className: "min-h-11",
                            }),
                          )}
                        >
                          Mark as read
                        </button>
                      </form>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
