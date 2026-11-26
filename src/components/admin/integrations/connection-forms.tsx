"use client";

import { useActionState, useRef } from "react";

import {
  createIntegrationAction,
  renameIntegrationAction,
  replaceIntegrationCredentialsAction,
  setIntegrationEnabledAction,
  testIntegrationAction,
  type IntegrationActionResult,
} from "@/app/admin/settings/integrations/actions";
import { buttonVariants } from "@/components/ui/button";
import type { OutboundProvider } from "@/lib/integrations/outbound/schema";

type ConnectionTarget = { id: string; configVersion: number };

const fieldClass =
  "min-h-11 w-full min-w-0 rounded-lg border border-border bg-background px-3 py-2 text-base focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50";

function Feedback({ result }: { result?: IntegrationActionResult }) {
  if (!result) return null;
  return (
    <p role={result.ok ? "status" : "alert"} className={result.ok ? "text-sm text-foreground" : "text-sm text-destructive"}>
      {result.message}
    </p>
  );
}

function Submit({ pending, children }: { pending: boolean; children: string }) {
  return (
    <button type="submit" disabled={pending} className={buttonVariants({ className: "min-h-11 w-fit max-w-full" })}>
      {pending ? "Working…" : children}
    </button>
  );
}

function TargetFields({ id, configVersion }: ConnectionTarget) {
  return (
    <>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="expectedVersion" value={configVersion} />
    </>
  );
}

export function CreateIntegrationForm({ provider }: { provider: OutboundProvider }) {
  const [result, action, pending] = useActionState(createIntegrationAction, undefined);
  const shopify = provider === "SHOPIFY";
  return (
    <form action={action} aria-busy={pending} className="flex min-w-0 flex-col gap-3 rounded-lg border border-border p-4">
      <h3 className="text-base font-medium">{shopify ? "Add Shopify store" : "Add ERPNext instance"}</h3>
      <input type="hidden" name="provider" value={provider} />
      <label className="flex flex-col gap-1 text-sm">
        Label
        <input className={fieldClass} name="label" maxLength={100} required disabled={pending} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {shopify ? "Store hostname" : "HTTPS origin"}
        <input
          className={fieldClass}
          name="origin"
          placeholder={shopify ? "store.myshopify.com" : "https://erp.example.com"}
          inputMode="url"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={270}
          required
          disabled={pending}
        />
      </label>
      <Feedback result={result} />
      <Submit pending={pending}>{shopify ? "Add Shopify store" : "Add ERPNext instance"}</Submit>
    </form>
  );
}

export function RenameIntegrationForm({ target, label }: { target: ConnectionTarget; label: string }) {
  const [result, action, pending] = useActionState(renameIntegrationAction, undefined);
  return (
    <form action={action} aria-busy={pending} className="flex flex-col gap-3">
      <TargetFields {...target} />
      <label className="flex flex-col gap-1 text-sm">
        Label
        <input className={fieldClass} name="label" defaultValue={label} maxLength={100} required disabled={pending} />
      </label>
      <Feedback result={result} />
      <Submit pending={pending}>Save label</Submit>
    </form>
  );
}

export function CredentialReplacementForm({ target, provider, configured }: {
  target: ConnectionTarget;
  provider: OutboundProvider;
  configured: boolean;
}) {
  const [result, dispatch, pending] = useActionState(replaceIntegrationCredentialsAction, undefined);
  const form = useRef<HTMLFormElement>(null);
  const shopify = provider === "SHOPIFY";
  return (
    <form
      ref={form}
      action={(data) => {
        form.current?.reset();
        dispatch(data);
      }}
      aria-busy={pending}
      className="flex flex-col gap-3"
    >
      <TargetFields {...target} />
      <label className="flex flex-col gap-1 text-sm">
        {shopify ? "App client ID" : "API key"}
        <input className={fieldClass} type="password" name="identifier" autoComplete="off" maxLength={2048} required disabled={pending} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {shopify ? "App client secret" : "API secret"}
        <input className={fieldClass} type="password" name="secret" autoComplete="new-password" maxLength={2048} required disabled={pending} />
      </label>
      <Feedback result={result} />
      <Submit pending={pending}>{configured ? "Replace credentials" : "Save credentials"}</Submit>
    </form>
  );
}

export function ConnectionStatusForms({ target, enabled, configured }: {
  target: ConnectionTarget;
  enabled: boolean;
  configured: boolean;
}) {
  const [status, statusAction, saving] = useActionState(setIntegrationEnabledAction, undefined);
  const [test, testAction, testing] = useActionState(testIntegrationAction, undefined);
  return (
    <div className="flex flex-wrap items-start gap-4">
      <form action={statusAction} aria-busy={saving} className="flex min-w-0 flex-col gap-2">
        <TargetFields {...target} />
        <input type="hidden" name="enabled" value={String(!enabled)} />
        <button type="submit" disabled={saving || testing || (!configured && !enabled)} className={buttonVariants({ variant: "outline", className: "min-h-11 w-fit" })}>
          {saving ? "Saving…" : enabled ? "Disable configuration" : "Enable configuration"}
        </button>
        <Feedback result={status} />
      </form>
      <form action={testAction} aria-busy={testing} className="flex min-w-0 flex-col gap-2">
        <TargetFields {...target} />
        <button type="submit" disabled={testing || saving} className={buttonVariants({ variant: "outline", className: "min-h-11 w-fit" })}>
          {testing ? "Testing…" : "Run mock test"}
        </button>
        <Feedback result={test} />
      </form>
    </div>
  );
}
