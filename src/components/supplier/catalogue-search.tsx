"use client";

import { useLayoutEffect, useRef } from "react";
import { useRouter } from "next/navigation";

export function CatalogueSearch({ search, page }: { search: string; page: number }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const previous = useRef({ search, page });

  useLayoutEffect(() => {
    if (previous.current.search !== search || previous.current.page !== page) {
      previous.current = { search, page };
      input.current?.focus();
    }
  }, [search, page]);

  return (
    <form method="get" className="flex items-end gap-2" onSubmit={(event) => {
      event.preventDefault();
      const query = String(new FormData(event.currentTarget).get("q") ?? "").trim();
      router.push(query ? `/supplier/catalogue?${new URLSearchParams({ q: query })}` : "/supplier/catalogue");
    }}>
      <label className="grid min-w-0 flex-1 gap-1 text-sm">
        Search products
        <input ref={input} key={search} id="catalogue-search" name="q" type="search"
          placeholder="SKU, product or brand" defaultValue={search} maxLength={100}
          className="min-h-11 min-w-0 rounded-md border bg-background px-3 text-base" />
      </label>
      <button className="min-h-11 rounded-md border px-3 text-sm font-medium">Search</button>
    </form>
  );
}
