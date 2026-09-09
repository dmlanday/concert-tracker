import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { resetDb, createTestUser } from "../helpers/db";

beforeEach(resetDb);
afterAll(async () => {
  await prisma.$disconnect();
});

async function makeVenue() {
  return prisma.venue.create({
    data: { name: "The Fillmore", nameKey: "the fillmore", city: "San Francisco", country: "US" },
  });
}

describe("schema constraints", () => {
  it("allows only one Event per venue per date", async () => {
    const venue = await makeVenue();
    const date = new Date("2026-06-13T00:00:00Z");

    await prisma.event.create({ data: { venueId: venue.id, date } });

    await expect(
      prisma.event.create({ data: { venueId: venue.id, date } }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("allows only one Performance per artist per event", async () => {
    const venue = await makeVenue();
    const event = await prisma.event.create({
      data: { venueId: venue.id, date: new Date("2026-06-13T00:00:00Z") },
    });
    const artist = await prisma.artist.create({
      data: { name: "Wednesday", nameKey: "wednesday" },
    });

    await prisma.performance.create({ data: { eventId: event.id, artistId: artist.id } });

    await expect(
      prisma.performance.create({ data: { eventId: event.id, artistId: artist.id } }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("allows many artists at one event, which is what makes festivals work", async () => {
    const venue = await makeVenue();
    const event = await prisma.event.create({
      data: { venueId: venue.id, date: new Date("2026-06-13T00:00:00Z") },
    });
    const a = await prisma.artist.create({ data: { name: "A", nameKey: "a" } });
    const b = await prisma.artist.create({ data: { name: "B", nameKey: "b" } });

    await prisma.performance.create({ data: { eventId: event.id, artistId: a.id } });
    await prisma.performance.create({ data: { eventId: event.id, artistId: b.id } });

    const count = await prisma.performance.count({ where: { eventId: event.id } });
    expect(count).toBe(2);
  });

  it("allows only one Attendance per user per event", async () => {
    const user = await createTestUser("dylan");
    const venue = await makeVenue();
    const event = await prisma.event.create({
      data: { venueId: venue.id, date: new Date("2026-06-13T00:00:00Z") },
    });

    await prisma.attendance.create({ data: { userId: user.id, eventId: event.id } });

    await expect(
      prisma.attendance.create({ data: { userId: user.id, eventId: event.id } }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("stores the show date without shifting it across a timezone boundary", async () => {
    const venue = await makeVenue();
    const event = await prisma.event.create({
      data: { venueId: venue.id, date: new Date("2026-06-13T00:00:00Z") },
    });

    const found = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(found.date.toISOString().slice(0, 10)).toBe("2026-06-13");
  });
});
