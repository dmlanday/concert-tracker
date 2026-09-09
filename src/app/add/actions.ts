"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/authz";
import { submitShow, type AddShowResult } from "@/domain/submit-show";

// The only export. It derives the user from the session, so the caller
// cannot name a user id.
export async function addShow(
  _prev: AddShowResult | null,
  formData: FormData,
): Promise<AddShowResult> {
  const user = await requireUser();

  // A user who has not claimed a handle has no profile URL to redirect to,
  // and "/u/null" would be a dead link. Send them to pick one first.
  if (!user.handle) redirect("/onboarding");

  const result = await submitShow(Object.fromEntries(formData), user.id);

  if (result.ok) {
    revalidatePath(`/u/${user.handle}`);
    redirect(`/u/${user.handle}/shows/${result.attendanceId}`);
  }

  return result;
}
