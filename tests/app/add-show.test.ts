import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db";
import { resetDb, createTestUser } from "../helpers/db";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("REDIRECT"), { url });
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { submitShow, addShowSchema } = await import("@/domain/submit-show");

beforeEach(resetDb);
afterAll(async () => {
  await prisma.$disconnect();
});

const valid = {
  artistName: "Wednesday",
  venueName: "The Fillmore",
  city: "San Francisco",
  state: "CA",
  country: "US",
  date: "2026-06-13",
  notes: "",
  attendedWith: "",
  setlist: "",
};

describe("addShowSchema", () => {
  it("accepts a complete valid entry", () => {
    expect(addShowSchema.safeParse(valid).success).toBe(true);
  });

  it.each([
    ["artistName", ""],
    ["venueName", ""],
    ["city", ""],
    ["country", ""],
    ["date", "13-06-2026"],
    ["date", "not-a-date"],
  ])("rejects %s = %s", (field, value) => {
    const result = addShowSchema.safeParse({ ...valid, [field]: value });
    expect(result.success).toBe(false);
  });

  it("rejects a rating outside 1 to 5", () => {
    expect(addShowSchema.safeParse({ ...valid, rating: 9 }).success).toBe(false);
  });

  it("rejects a date in the future, since you cannot have attended it yet", () => {
    const result = addShowSchema.safeParse({ ...valid, date: "2099-01-01" });
    expect(result.success).toBe(false);
  });
});

describe("submitShow", () => {
  it("logs the show and returns the new attendance", async () => {
    const user = await createTestUser("dylan");

    const result = await submitShow(valid, user.id);

    expect(result.ok).toBe(true);
    expect(await prisma.attendance.count({ where: { userId: user.id } })).toBe(1);
  });

  it("splits a pasted setlist on newlines", async () => {
    const user = await createTestUser("dylan");

    await submitShow(
      { ...valid, setlist: "Bull Believer\nChosen to Deserve\n\nBath County" },
      user.id,
    );

    expect(await prisma.setlistSong.count()).toBe(3);
  });

  it("returns a field error rather than throwing on invalid input", async () => {
    const user = await createTestUser("dylan");

    const result = await submitShow({ ...valid, artistName: "" }, user.id);

    expect(result.ok).toBe(false);
    expect(await prisma.attendance.count()).toBe(0);
  });
});
