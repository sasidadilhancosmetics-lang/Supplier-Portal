"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  markAllNotificationsReadForCurrentUser,
  markNotificationRead,
} from "@/lib/notifications";

export async function markNotificationReadAction(formData: FormData) {
  const id = String(formData.get("notificationId") ?? "");
  if (!id) return;
  await markNotificationRead(id);
  revalidatePath("/supplier/notifications");
  revalidatePath("/supplier");
}

export async function markAllNotificationsReadAction() {
  await markAllNotificationsReadForCurrentUser();
  revalidatePath("/supplier/notifications");
  revalidatePath("/supplier");
  redirect("/supplier/notifications");
}
