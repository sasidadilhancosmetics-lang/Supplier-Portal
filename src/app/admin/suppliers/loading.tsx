export default function SuppliersLoading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-live="polite">
      <div className="h-9 w-48 animate-pulse rounded-lg bg-muted" />
      <div className="h-11 w-full max-w-xl animate-pulse rounded-lg bg-muted" />
      <div className="h-40 w-full animate-pulse rounded-lg bg-muted" />
      <p className="text-sm text-muted-foreground">Loading suppliers…</p>
    </div>
  );
}
