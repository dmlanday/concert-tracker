"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { attendPerformance } from "@/domain/log-show";
import { requireUser } from "@/lib/authz";

const schema = z.object({ performanceId: z.string().min(1), eventId: z.string().min(1) });

export async function markAttended(formData: FormData) {
  const user = await requireUser();
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;

  await attendPerformance(user.id, parsed.data.performanceId);
  revalidatePath(`/events/${parsed.data.eventId}`);
  if (user.handle) revalidatePath(`/u/${user.handle}`);
}
