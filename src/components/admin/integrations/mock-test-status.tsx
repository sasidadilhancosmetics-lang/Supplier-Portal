import { formatDateTime } from "@/lib/dates";
import { mockMessages, type MockResult } from "@/lib/integrations/outbound/mock-provider";

export function MockTestStatus({ result, configVersion }: {
  result: { result: MockResult; configVersion: number; createdAt: Date } | null;
  configVersion: number;
}) {
  if (!result) return <p className="text-sm text-muted-foreground">No mock test recorded.</p>;

  return (
    <p className="text-sm">
      {mockMessages[result.result]} · {formatDateTime(result.createdAt)}
      {result.configVersion !== configVersion ? " · Earlier configuration" : null}
    </p>
  );
}
