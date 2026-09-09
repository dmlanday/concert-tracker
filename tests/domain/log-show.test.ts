import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { resetDb, createTestUser } from "../helpers/db";
import { logShow, attendPerformance } from "@/domain/log-show";

beforeEach(resetDb);
afterAll(async () => {
  await prisma.$disconnect();
});

const base = {
  venueName: "The Fillmore",
  city: "San Francisco",
  country: "US",
  date: "2026-06-13",
};

describe("logShow", () => {
  it("creates artist, venue, event, performance, attendance and attended row", async () => {
    const user = await createTestUser("dylan");

    const result = await logShow({ ...base, userId: user.id, artistName: "Wednesday" });

    expect(result.joinedExistingEvent).toBe(false);
    expect(result.alreadyAttended).toBe(false);

    const attendance = await prisma.attendance.findUniqueOrThrow({
      where: { id: result.attendanceId },
      include: { attended: true, event: { include: { venue: true, performances: true } } },
    });

    expect(attendance.event.venue.name).toBe("The Fillmore");
    expect(attendance.event.performances).toHaveLength(1);
    expect(attendance.attended).toHaveLength(1);
    expect(attendance.attended[0].performanceId).toBe(result.performanceId);
  });

  it("dedupes the artist by normalized name so spacing and case do not fork rows", async () => {
    const a = await createTestUser("a");
    const b = await createTestUser("b");

    await logShow({ ...base, userId: a.id, artistName: "Wednesday" });
    await logShow({ ...base, userId: b.id, artistName: "  wednesday " });

    expect(await prisma.artist.count()).toBe(1);
  });

  it("attaches a second artist on the same night to the SAME event", async () => {
    const a = await createTestUser("a");
    const b = await createTestUser("b");

    const first = await logShow({ ...base, userId: a.id, artistName: "Wednesday" });
    const second = await logShow({ ...base, userId: b.id, artistName: "MJ Lenderman" });

    expect(second.eventId).toBe(first.eventId);
    expect(second.joinedExistingEvent).toBe(true);
    expect(await prisma.event.count()).toBe(1);
    expect(await prisma.performance.count({ where: { eventId: first.eventId } })).toBe(2);
  });

  it("does not create a second event for a different venue on the same date", async () => {
    const user = await createTestUser("dylan");

    await logShow({ ...base, userId: user.id, artistName: "Wednesday" });
    await logShow({
      ...base,
      userId: user.id,
      artistName: "Wednesday",
      venueName: "Great American Music Hall",
    });

    expect(await prisma.event.count()).toBe(2);
  });

  it("adds a second act to the user's EXISTING attendance instead of failing", async () => {
    const user = await createTestUser("dylan");

    const first = await logShow({ ...base, userId: user.id, artistName: "Wednesday" });
    const second = await logShow({ ...base, userId: user.id, artistName: "MJ Lenderman" });

    expect(second.attendanceId).toBe(first.attendanceId);
    expect(second.alreadyAttended).toBe(true);

    const attended = await prisma.attendedPerformance.count({
      where: { attendanceId: first.attendanceId },
    });
    expect(attended).toBe(2);
  });

  it("is idempotent when the same user logs the identical show twice", async () => {
    const user = await createTestUser("dylan");

    const first = await logShow({ ...base, userId: user.id, artistName: "Wednesday" });
    const second = await logShow({ ...base, userId: user.id, artistName: "Wednesday" });

    expect(second.attendanceId).toBe(first.attendanceId);
    expect(second.performanceId).toBe(first.performanceId);
    expect(await prisma.attendedPerformance.count()).toBe(1);
  });

  it("stores a manually typed setlist in order", async () => {
    const user = await createTestUser("dylan");

    const result = await logShow({
      ...base,
      userId: user.id,
      artistName: "Wednesday",
      songs: ["Bull Believer", "Chosen to Deserve", "Bath County"],
    });

    const songs = await prisma.setlistSong.findMany({
      where: { performanceId: result.performanceId },
      orderBy: { position: "asc" },
    });

    expect(songs.map((s) => s.name)).toEqual([
      "Bull Believer",
      "Chosen to Deserve",
      "Bath County",
    ]);
    expect(songs.map((s) => s.position)).toEqual([0, 1, 2]);
  });

  it("ignores blank song lines rather than storing empty songs", async () => {
    const user = await createTestUser("dylan");

    const result = await logShow({
      ...base,
      userId: user.id,
      artistName: "Wednesday",
      songs: ["Bull Believer", "   ", "", "Bath County"],
    });

    const songs = await prisma.setlistSong.findMany({
      where: { performanceId: result.performanceId },
    });
    expect(songs).toHaveLength(2);
  });

  it("does not duplicate songs when the same performance is logged again", async () => {
    const a = await createTestUser("a");
    const b = await createTestUser("b");

    await logShow({ ...base, userId: a.id, artistName: "Wednesday", songs: ["Bull Believer"] });
    await logShow({ ...base, userId: b.id, artistName: "Wednesday", songs: ["Bull Believer"] });

    expect(await prisma.setlistSong.count()).toBe(1);
  });

  it("stores the date as the calendar day given, with no timezone drift", async () => {
    const user = await createTestUser("dylan");

    const result = await logShow({ ...base, userId: user.id, artistName: "Wednesday" });
    const event = await prisma.event.findUniqueOrThrow({ where: { id: result.eventId } });

    expect(event.date.toISOString().slice(0, 10)).toBe("2026-06-13");
  });

  it("rejects a malformed date", async () => {
    const user = await createTestUser("dylan");

    await expect(
      logShow({ ...base, userId: user.id, artistName: "Wednesday", date: "13-06-2026" }),
    ).rejects.toThrow(/date/i);
  });
});

describe("attendPerformance", () => {
  it("lets a user tick another act from a lineup they already attended", async () => {
    const a = await createTestUser("a");
    const b = await createTestUser("b");

    // User A logs the headliner. User B logs the opener, creating a second
    // performance on the same event.
    await logShow({ ...base, userId: a.id, artistName: "Wednesday" });
    const opener = await logShow({ ...base, userId: b.id, artistName: "MJ Lenderman" });

    // User A now says they also caught the opener.
    const { attendanceId } = await attendPerformance(a.id, opener.performanceId);

    const attended = await prisma.attendedPerformance.count({ where: { attendanceId } });
    expect(attended).toBe(2);
  });

  it("is idempotent when ticking the same act twice", async () => {
    const user = await createTestUser("dylan");
    const show = await logShow({ ...base, userId: user.id, artistName: "Wednesday" });

    await attendPerformance(user.id, show.performanceId);

    expect(
      await prisma.attendedPerformance.count({ where: { attendanceId: show.attendanceId } }),
    ).toBe(1);
  });
});
