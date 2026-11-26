import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  ConnectionStatusForms,
  CredentialReplacementForm,
  RenameIntegrationForm,
} from "@/components/admin/integrations/connection-forms";
import { MockTestStatus } from "@/components/admin/integrations/mock-test-status";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { formatDateTime } from "@/lib/dates";
import { getAdminIntegration } from "@/lib/integrations/outbound/admin";
import { OutboundIntegrationError } from "@/lib/integrations/outbound/errors";

export const metadata: Metadata = { title: "Integration settings" };
export const instant = false;

export default async function IntegrationDetailPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const [{ id }, { page }] = await Promise.all([params, searchParams]);
  let data;
  try {
    data = await getAdminIntegration(id, page);
  } catch (error) {
    if (error instanceof OutboundIntegrationError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const { connection, lastMock, history, historyPage, hasMoreHistory } = data;
  const target = { id: connection.id, configVersion: connection.configVersion };
  const configured = connection.credentialRotatedAt !== null;
  const provider = connection.provider === "ERP_NEXT" ? "ERPNext" : "Shopify";
  const detailHref = `/admin/settings/integrations/${encodeURIComponent(id)}`;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">Settings / Integrations / {provider}</p>
          <h1 className="text-3xl font-semibold tracking-tight [overflow-wrap:anywhere]">{connection.label}</h1>
          <p className="mt-1 text-sm text-muted-foreground [overflow-wrap:anywhere]">{connection.origin}</p>
        </div>
        <Link href="/admin/settings/integrations" className={buttonVariants({ variant: "outline", className: "min-h-11" })}>Back to integrations</Link>
      </header>

      <section aria-labelledby="status-heading" className="space-y-3 rounded-lg border border-border p-4">
        <h2 id="status-heading" className="text-lg font-medium">Connection status</h2>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{connection.enabled ? "Configuration enabled" : "Configuration disabled"}</Badge>
          <Badge variant="outline">Live connectivity unverified</Badge>
        </div>
        <MockTestStatus result={lastMock} configVersion={connection.configVersion} />
        <ConnectionStatusForms target={target} configured={configured} enabled={connection.enabled} />
      </section>

      <div className="grid items-start gap-4 md:grid-cols-2">
        <section aria-labelledby="label-heading" className="min-w-0 space-y-3 rounded-lg border border-border p-4">
          <h2 id="label-heading" className="text-lg font-medium">Connection label</h2>
          <RenameIntegrationForm target={target} label={connection.label} />
        </section>
        <section aria-labelledby="credential-heading" className="min-w-0 space-y-3 rounded-lg border border-border p-4">
          <h2 id="credential-heading" className="text-lg font-medium">Credentials</h2>
          <p className="text-sm text-muted-foreground">
            {connection.credentialRotatedAt
              ? `Configured · Updated ${formatDateTime(connection.credentialRotatedAt)}`
              : "No credentials configured."}
          </p>
          <p className="text-sm text-muted-foreground">Enter both values to replace the encrypted credentials.</p>
          <CredentialReplacementForm target={target} provider={connection.provider} configured={configured} />
        </section>
      </div>

      <section aria-labelledby="history-heading" className="space-y-3 rounded-lg border border-border p-4">
        <h2 id="history-heading" className="text-lg font-medium">Recent audit history</h2>
        {history.length === 0 ? <p className="text-sm text-muted-foreground">No activity recorded.</p> : (
          <ul className="divide-y divide-border">
            {history.map((event) => (
              <li key={event.id} className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-2 text-sm">
                <span>{event.label}</span>
                <span className="text-muted-foreground">{formatDateTime(event.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
        {historyPage > 1 || hasMoreHistory ? (
          <nav aria-label="Audit history pages" className="flex flex-wrap items-center gap-2">
            {historyPage > 1 ? (
              <Link className={buttonVariants({ variant: "outline", className: "min-h-11" })} href={`${detailHref}?page=${historyPage - 1}#history-heading`}>
                Newer entries
              </Link>
            ) : null}
            {hasMoreHistory ? (
              <Link className={buttonVariants({ variant: "outline", className: "min-h-11" })} href={`${detailHref}?page=${historyPage + 1}#history-heading`}>
                Older entries
              </Link>
            ) : null}
          </nav>
        ) : null}
      </section>
    </div>
  );
}
