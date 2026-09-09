import { prisma } from "@/lib/db";
import { handleSchema } from "@/lib/handle";

export type ClaimResult = { ok: true; handle: string } | { ok: false; error: string };

/**
 * Testable core. It takes an explicit userId, which is exactly why it must
 * not live in a "use server" module: that would expose it as an endpoint
 * anyone could call with someone else's user id.
 */
export async function claimHandleFor(userId: string, raw: string): Promise<ClaimResult> {
  const parsed = handleSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  const handle = parsed.data;

  const existing = await prisma.user.findUnique({ where: { handle } });
  if (existing && existing.id !== userId) {
    return { ok: false, error: "That handle is already taken" };
  }

  try {
    await prisma.user.update({ where: { id: userId }, data: { handle } });
  } catch (error) {
    // Lost a race against a concurrent claim of the same handle.
    if ((error as { code?: string }).code === "P2002") {
      return { ok: false, error: "That handle is already taken" };
    }
    throw error;
  }

  return { ok: true, handle };
}
