import type { Metadata } from "next";
import Link from "next/link";

import { CreateIntegrationForm } from "@/components/admin/integrations/connection-forms";
import { MockTestStatus } from "@/components/admin/integrations/mock-test-status";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/dates";
import { listAdminIntegrations } from "@/lib/integrations/outbound/admin";

export const metadata: Metadata = { title: "Integrations" };
export const instant = false;

const providers = [
  { provider: "ERP_NEXT", name: "ERPNext", empty: "No ERPNext instances configured." },
  { provider: "SHOPIFY", name: "Shopify", empty: "No Shopify stores configured." },
] as const;

export default async function IntegrationsPage() {
  const { connections, cosmo } = await listAdminIntegrations();
  return (
    <div className="flex min-w-0 flex-col gap-8">
      <header>
        <p className="text-sm text-muted-foreground">Settings</p>
        <h1 className="text-3xl font-semibold tracking-tight">Integrations</h1>
      </header>

      <p className="text-sm text-muted-foreground">ERPNext and Shopify connection tests run in mock mode.</p>
      <div className="grid items-start gap-6 md:grid-cols-2">
        {providers.map(({ provider, name, empty }) => {
          const providerConnections = connections.filter((connection) => connection.provider === provider);
          return (
            <section key={provider} aria-labelledby={`${provider}-heading`} className="min-w-0 space-y-3">
              <h2 id={`${provider}-heading`} className="text-lg font-medium">{name}</h2>
              {providerConnections.length === 0 ? <p className="text-sm text-muted-foreground">{empty}</p> : (
                <ul className="grid gap-3">
                  {providerConnections.map((connection) => (
                    <li key={connection.id} className="min-w-0">
                      <Link
                        className="block min-h-11 space-y-2 rounded-lg border border-border p-4 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        href={`/admin/settings/integrations/${encodeURIComponent(connection.id)}`}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium [overflow-wrap:anywhere]">{connection.label}</span>
                          <Badge variant="outline">{connection.enabled ? "Enabled" : "Disabled"}</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{connection.origin}</p>
                        <p className="text-sm text-muted-foreground">
                          {connection.credentialRotatedAt ? "Credentials configured" : "Credentials not configured"}
                        </p>
                        <MockTestStatus result={connection.lastMock} configVersion={connection.configVersion} />
                        <p className="text-sm text-muted-foreground">Live connectivity unverified</p>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <CreateIntegrationForm provider={provider} />
            </section>
          );
        })}
      </div>

      <section aria-labelledby="cosmo-heading" className="space-y-3">
        <h2 id="cosmo-heading" className="text-lg font-medium">Cosmo OS inbound</h2>
        {cosmo.length === 0 ? <p className="text-sm text-muted-foreground">No inbound credentials configured.</p> : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {cosmo.map((credential) => (
              <li key={credential.id} className="min-w-0 rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium [overflow-wrap:anywhere]">{credential.name}</span>
                  <Badge variant="outline">{credential.status}</Badge>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">Last used {credential.lastUsedAt ? formatDateTime(credential.lastUsedAt) : "Never"}</p>
                <p className="text-sm text-muted-foreground">Expires {credential.expiresAt ? formatDateTime(credential.expiresAt) : "Never"}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
