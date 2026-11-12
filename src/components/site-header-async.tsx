import { SiteHeader } from "@/components/site-header";
import { navAreasForAuth } from "@/lib/auth/nav";
import { getAuthState } from "@/lib/auth/session";

export async function SiteHeaderAsync() {
  const auth = await getAuthState();
  return <SiteHeader auth={auth} navAreas={navAreasForAuth(auth)} />;
}

export function SiteHeaderFallback() {
  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4">
        <div className="flex flex-col">
          <span className="text-base font-semibold">Supplier Portal</span>
          <span className="text-sm text-muted-foreground">Auth foundation</span>
        </div>
        <div
          className="h-11 w-24 animate-pulse rounded-lg bg-muted"
          aria-hidden
        />
      </div>
    </header>
  );
}
