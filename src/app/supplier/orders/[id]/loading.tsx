export default function SupplierOrderDetailLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="h-9 w-56 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
      <div className="h-40 w-full animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
      <div className="h-11 w-48 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
    </div>
  );
}
