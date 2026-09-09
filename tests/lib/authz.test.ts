import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db";
import { resetDb, createTestUser } from "../helpers/db";
import { logShow } from "@/domain/log-show";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => mockAuth() }));

const { requireUser, requireOwner } = await import("@/lib/authz");

beforeEach(async () => {
  await resetDb();
  mockAuth.mockReset();
});
afterAll(async () => {
  await prisma.$disconnect();
});

const show = {
  venueName: "The Fillmore",
  city: "San Francisco",
  country: "US",
  date: "2026-06-13",
  artistName: "Wednesday",
};

describe("requireUser", () => {
  it("returns the session user when signed in", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", handle: "dylan" } });
    await expect(requireUser()).resolves.toMatchObject({ id: "u1" });
  });

  it("throws when there is no session", async () => {
    mockAuth.mockResolvedValue(null);
    await expect(requireUser()).rejects.toThrow(/not signed in/i);
  });

  it("throws when the session exists but carries no user id", async () => {
    mockAuth.mockResolvedValue({ user: {} });
    await expect(requireUser()).rejects.toThrow(/not signed in/i);
  });
});

describe("requireOwner", () => {
  it("returns the attendance when the caller owns it", async () => {
    const owner = await createTestUser("owner");
    const logged = await logShow({ ...show, userId: owner.id });
    mockAuth.mockResolvedValue({ user: { id: owner.id, handle: "owner" } });

    await expect(requireOwner(logged.attendanceId)).resolves.toMatchObject({
      id: logged.attendanceId,
    });
  });

  it("refuses when a different signed-in user owns it", async () => {
    const owner = await createTestUser("owner");
    const attacker = await createTestUser("attacker");
    const logged = await logShow({ ...show, userId: owner.id });
    mockAuth.mockResolvedValue({ user: { id: attacker.id, handle: "attacker" } });

    await expect(requireOwner(logged.attendanceId)).rejects.toThrow(/not allowed/i);
  });

  it("refuses for an attendance that does not exist", async () => {
    const user = await createTestUser("dylan");
    mockAuth.mockResolvedValue({ user: { id: user.id, handle: "dylan" } });

    await expect(requireOwner("does-not-exist")).rejects.toThrow(/not allowed/i);
  });

  it("does not reveal whether a stranger's attendance exists", async () => {
    const owner = await createTestUser("owner");
    const attacker = await createTestUser("attacker");
    const logged = await logShow({ ...show, userId: owner.id });
    mockAuth.mockResolvedValue({ user: { id: attacker.id, handle: "attacker" } });

    const real = await requireOwner(logged.attendanceId).catch((e: Error) => e.message);
    const fake = await requireOwner("does-not-exist").catch((e: Error) => e.message);

    expect(real).toBe(fake);
  });
});
