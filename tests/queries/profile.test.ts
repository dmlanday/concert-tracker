import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { resetDb, createTestUser } from "../helpers/db";
import { logShow } from "@/domain/log-show";
import { getProfile, getEvent } from "@/queries/profile";

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

describe("getProfile", () => {
  it("returns null for an unknown handle", async () => {
    expect(await getProfile("nobody")).toBeNull();
  });

  it("lists the user's shows with the acts they attended", async () => {
    const user = await createTestUser("dylan");
    await logShow({ ...base, userId: user.id, artistName: "Wednesday" });

    const profile = await getProfile("dylan");

    expect(profile).not.toBeNull();
    expect(profile!.shows).toHaveLength(1);
    expect(profile!.shows[0].attendedArtistNames).toEqual(["Wednesday"]);
    expect(profile!.shows[0].lineupSize).toBe(1);
  });

  it("reports the full lineup size while listing only the acts the user caught", async () => {
    const dylan = await createTestUser("dylan");
    const other = await createTestUser("other");

    await logShow({ ...base, userId: dylan.id, artistName: "Wednesday" });
    await logShow({ ...base, userId: other.id, artistName: "MJ Lenderman" });

    const profile = await getProfile("dylan");

    expect(profile!.shows[0].attendedArtistNames).toEqual(["Wednesday"]);
    expect(profile!.shows[0].lineupSize).toBe(2);
  });

  it("orders shows most recent first", async () => {
    const user = await createTestUser("dylan");
    await logShow({ ...base, userId: user.id, artistName: "Older", date: "2025-01-01" });
    await logShow({ ...base, userId: user.id, artistName: "Newer", date: "2026-01-01" });

    const profile = await getProfile("dylan");

    expect(profile!.shows.map((s) => s.date.toISOString().slice(0, 10))).toEqual([
      "2026-01-01",
      "2025-01-01",
    ]);
  });

  it("does not leak another user's shows onto this profile", async () => {
    const dylan = await createTestUser("dylan");
    const other = await createTestUser("other");
    await logShow({ ...base, userId: other.id, artistName: "Wednesday" });

    const profile = await getProfile("dylan");
    expect(profile!.shows).toHaveLength(0);
  });
});

describe("getEvent", () => {
  it("returns the full lineup and every attendee", async () => {
    const a = await createTestUser("a");
    const b = await createTestUser("b");

    const first = await logShow({ ...base, userId: a.id, artistName: "Wednesday" });
    await logShow({ ...base, userId: b.id, artistName: "MJ Lenderman" });

    const event = await getEvent(first.eventId);

    expect(event!.performances.map((p) => p.artistName).sort()).toEqual([
      "MJ Lenderman",
      "Wednesday",
    ]);
    expect(event!.attendees.map((u) => u.handle).sort()).toEqual(["a", "b"]);
  });

  it("returns null for an unknown event", async () => {
    expect(await getEvent("nope")).toBeNull();
  });
});
