"use client";

import { useActionState } from "react";

import {
  inviteSupplierUserAction,
  revokeInvitationAction,
  setSupplierUserActiveAction,
  type InviteActionResult,
  type UserActionResult,
} from "@/app/admin/suppliers/users-actions";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type UserRow = {
  id: string;
  email: string;
  name: string | null;
  isActive: boolean;
  linked: boolean;
  lastLoginAt: Date | string | null;
};

type InviteRow = {
  id: string;
  invitedEmail: string;
  status: string;
  expiresAt: Date | string;
  createdAt: Date | string;
};

const fieldClass =
  "min-h-11 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function formatWhen(value: Date | string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function SupplierUsersPanel({
  supplierId,
  users,
  invitations,
}: {
  supplierId: string;
  users: UserRow[];
  invitations: InviteRow[];
}) {
  const [inviteState, inviteAction, invitePending] = useActionState(
    inviteSupplierUserAction,
    undefined as InviteActionResult | undefined,
  );
  const [revokeState, revokeAction, revokePending] = useActionState(
    revokeInvitationAction,
    undefined as UserActionResult | undefined,
  );
  const [activeState, activeAction, activePending] = useActionState(
    setSupplierUserActiveAction,
    undefined as UserActionResult | undefined,
  );

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Users</h2>
        <p className="text-sm text-muted-foreground">
          Invite people to this supplier company. Email is only the invitation
          destination — Auth0 identity is linked on accept.
        </p>
      </div>

      <form
        action={inviteAction}
        className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-end"
      >
        <input type="hidden" name="supplierId" value={supplierId} />
        <label className="flex flex-1 flex-col gap-1.5">
          <span className="text-sm font-medium">Invite email</span>
          <input
            className={fieldClass}
            type="email"
            name="email"
            required
            placeholder="user@example.com"
            autoComplete="email"
          />
        </label>
        <button
          type="submit"
          disabled={invitePending}
          className={cn(buttonVariants({ className: "min-h-11" }))}
        >
          {invitePending ? "Creating…" : "Create invitation"}
        </button>
      </form>

      {inviteState && !inviteState.ok ? (
        <p role="alert" className="text-sm text-destructive">
          {inviteState.error}
        </p>
      ) : null}

      {inviteState?.ok && inviteState.acceptUrl ? (
        <div className="rounded-lg border bg-muted px-4 py-3 text-sm leading-6">
          <p className="font-medium">Development invitation link</p>
          <p className="mt-1 text-muted-foreground">
            No email provider is configured. Copy this link now — it is shown
            once and is not stored in plaintext.
          </p>
          <p className="mt-2 break-all font-mono text-xs">{inviteState.acceptUrl}</p>
          {inviteState.expiresAt ? (
            <p className="mt-2 text-muted-foreground">
              Expires {formatWhen(inviteState.expiresAt)}
            </p>
          ) : null}
        </div>
      ) : null}

      {(revokeState && !revokeState.ok) || (activeState && !activeState.ok) ? (
        <p role="alert" className="text-sm text-destructive">
          {revokeState && !revokeState.ok
            ? revokeState.error
            : activeState && !activeState.ok
              ? activeState.error
              : null}
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-lg border">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b bg-muted/50">
            <tr>
              <th className="px-3 py-3 font-medium">User</th>
              <th className="px-3 py-3 font-medium">Status</th>
              <th className="px-3 py-3 font-medium">Auth0</th>
              <th className="px-3 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-muted-foreground">
                  No linked users yet.
                </td>
              </tr>
            ) : (
              users.map((user) => (
                <tr key={user.id} className="border-b last:border-0">
                  <td className="px-3 py-3">
                    <div className="flex flex-col">
                      <span className="font-medium">{user.email}</span>
                      <span className="text-muted-foreground">
                        {user.name ?? "—"}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <Badge variant={user.isActive ? "default" : "secondary"}>
                      {user.isActive ? "Active" : "Disabled"}
                    </Badge>
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {user.linked ? "Linked" : "Not linked"}
                  </td>
                  <td className="px-3 py-3">
                    <form action={activeAction}>
                      <input type="hidden" name="supplierId" value={supplierId} />
                      <input type="hidden" name="userId" value={user.id} />
                      <input
                        type="hidden"
                        name="isActive"
                        value={user.isActive ? "false" : "true"}
                      />
                      <button
                        type="submit"
                        disabled={activePending}
                        className={cn(
                          buttonVariants({
                            variant: "outline",
                            className: "min-h-11",
                          }),
                        )}
                      >
                        {user.isActive ? "Disable" : "Enable"}
                      </button>
                    </form>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="text-base font-medium">Invitations</h3>
        <div className="overflow-x-auto rounded-lg border">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-3 py-3 font-medium">Email</th>
                <th className="px-3 py-3 font-medium">State</th>
                <th className="px-3 py-3 font-medium">Expires</th>
                <th className="px-3 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {invitations.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-4 text-muted-foreground">
                    No invitations yet.
                  </td>
                </tr>
              ) : (
                invitations.map((invite) => (
                  <tr key={invite.id} className="border-b last:border-0">
                    <td className="px-3 py-3">{invite.invitedEmail}</td>
                    <td className="px-3 py-3">
                      <Badge variant="outline">{invite.status}</Badge>
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">
                      {formatWhen(invite.expiresAt)}
                    </td>
                    <td className="px-3 py-3">
                      {invite.status === "PENDING" ? (
                        <form action={revokeAction}>
                          <input
                            type="hidden"
                            name="supplierId"
                            value={supplierId}
                          />
                          <input
                            type="hidden"
                            name="invitationId"
                            value={invite.id}
                          />
                          <button
                            type="submit"
                            disabled={revokePending}
                            className={cn(
                              buttonVariants({
                                variant: "outline",
                                className: "min-h-11",
                              }),
                            )}
                          >
                            Revoke
                          </button>
                        </form>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
