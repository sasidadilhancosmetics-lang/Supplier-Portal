import type { ReactNode } from "react";

import { requireAdminPage } from "@/lib/auth/guards";

export const instant = false;

export default async function AdminLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  await requireAdminPage();
  return children;
}
