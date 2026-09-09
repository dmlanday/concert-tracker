"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/authz";
import { claimHandleFor, type ClaimResult } from "@/domain/claim-handle";

// The only export, and it derives the user from the session rather than
// accepting a user id from the caller.
export async function claimHandle(
  _prev: ClaimResult | null,
  formData: FormData,
): Promise<ClaimResult> {
  const user = await requireUser();
  const result = await claimHandleFor(user.id, String(formData.get("handle") ?? ""));

  if (result.ok) redirect(`/u/${result.handle}`);
  return result;
}
