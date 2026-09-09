import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export class NotSignedInError extends Error {
  constructor() {
    super("Not signed in");
    this.name = "NotSignedInError";
  }
}

export class NotAllowedError extends Error {
  constructor() {
    // Deliberately identical whether the row is missing or owned by someone
    // else. A distinct "not found" message would let anyone probe which
    // attendance ids exist.
    super("Not allowed");
    this.name = "NotAllowedError";
  }
}

export async function requireUser(): Promise<{ id: string; handle: string | null }> {
  const session = await auth();
  if (!session?.user?.id) throw new NotSignedInError();
  return { id: session.user.id, handle: session.user.handle ?? null };
}

/**
 * Resolves an attendance and proves the caller owns it. Every mutation on a
 * user's own content goes through here (spec 6.2), so ownership is enforced in
 * exactly one auditable place.
 */
export async function requireOwner(attendanceId: string) {
  const user = await requireUser();

  const attendance = await prisma.attendance.findUnique({
    where: { id: attendanceId },
  });

  if (!attendance || attendance.userId !== user.id) throw new NotAllowedError();

  return attendance;
}
