"use client";

import { Button } from "@/components/ui/button";

export default function CatalogueError({ reset }: { reset: () => void }) {
  return (
    <div className="space-y-3">
      <p role="alert">The catalogue could not load.</p>
      <Button className="min-h-11" onClick={reset}>Try again</Button>
    </div>
  );
}
