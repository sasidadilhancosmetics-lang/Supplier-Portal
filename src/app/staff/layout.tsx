import type { ReactNode } from "react";

import { requireStaffAreaPage } from "@/lib/auth/guards";

export const instant = false;

export default async function StaffLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  // Area entry: ADMIN or STAFF. Fine-grained actions use requireStaffPermission().
  await requireStaffAreaPage();
  return children;
}
