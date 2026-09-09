import { prisma } from "@/lib/db";

/**
 * Truncates every domain table between tests. Faster than re-running
 * migrations, and RESTART IDENTITY keeps sequences predictable.
 */
export async function resetDb(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "AttendedPerformance", "Attendance", "SetlistSong",
      "Performance", "Event", "Venue", "Artist",
      "Session", "Account", "VerificationToken", "User"
    RESTART IDENTITY CASCADE;
  `);
}

export async function createTestUser(handle: string) {
  return prisma.user.create({
    data: { handle, email: `${handle}@example.test`, name: handle },
  });
}
