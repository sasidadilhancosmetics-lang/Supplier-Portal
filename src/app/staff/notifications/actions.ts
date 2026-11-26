"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  markAllNotificationsReadForCurrentUser,
  markNotificationRead,
} from "@/lib/notifications";

export async function markCompanyNotificationReadAction(formData: FormData) {
  const id = String(formData.get("notificationId") ?? "");
  if (!id) return;
  await markNotificationRead(id);
  revalidatePath("/staff/notifications");
  revalidatePath("/staff");
  revalidatePath("/admin");
}

export async function markAllCompanyNotificationsReadAction() {
  await markAllNotificationsReadForCurrentUser();
  revalidatePath("/staff/notifications");
  revalidatePath("/staff");
  revalidatePath("/admin");
  redirect("/staff/notifications");
}
