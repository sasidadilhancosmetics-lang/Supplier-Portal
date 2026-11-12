import { Badge } from "@/components/ui/badge";

type PlaceholderPageProps = {
  title: string;
  audience: string;
  purpose: string;
};

export function PlaceholderPage({
  title,
  audience,
  purpose,
}: PlaceholderPageProps) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Badge variant="secondary">Non-functional</Badge>
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="text-muted-foreground">For: {audience}</p>
      </div>
      <p className="max-w-2xl text-base leading-7">{purpose}</p>
      <p className="max-w-2xl rounded-lg border bg-muted px-4 py-3 text-sm leading-6">
        This area is role-gated on the server. Business data and actions are not
        connected yet.
      </p>
    </div>
  );
}
