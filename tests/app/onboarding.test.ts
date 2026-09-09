import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db";
import { resetDb } from "../helpers/db";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => mockAuth() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("REDIRECT"), { url });
  },
}));

const { claimHandleFor } = await import("@/domain/claim-handle");

beforeEach(async () => {
  await resetDb();
  mockAuth.mockReset();
});
afterAll(async () => {
  await prisma.$disconnect();
});

async function newUser(email: string) {
  return prisma.user.create({ data: { email, handle: null } });
}

describe("claimHandleFor", () => {
  it("sets the handle on the user", async () => {
    const user = await newUser("a@example.test");

    const result = await claimHandleFor(user.id, "dylan");

    expect(result).toEqual({ ok: true, handle: "dylan" });
    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.handle).toBe("dylan");
  });

  it("normalizes case so the stored handle is lowercase", async () => {
    const user = await newUser("a@example.test");
    await claimHandleFor(user.id, "Dylan");

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.handle).toBe("dylan");
  });

  it("rejects an invalid handle with a readable message", async () => {
    const user = await newUser("a@example.test");

    const result = await claimHandleFor(user.id, "no");

    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toMatch(/at least 3/i);
  });

  it("rejects a reserved handle", async () => {
    const user = await newUser("a@example.test");

    const result = await claimHandleFor(user.id, "settings");

    expect((result as { error: string }).error).toMatch(/reserved/i);
  });

  it("rejects a handle already taken, without leaving the user handleless", async () => {
    const taken = await newUser("a@example.test");
    await claimHandleFor(taken.id, "dylan");
    const second = await newUser("b@example.test");

    const result = await claimHandleFor(second.id, "dylan");

    expect((result as { error: string }).error).toMatch(/taken/i);
    const stillNull = await prisma.user.findUniqueOrThrow({ where: { id: second.id } });
    expect(stillNull.handle).toBeNull();
  });

  it("treats a differently-cased duplicate as taken", async () => {
    const first = await newUser("a@example.test");
    await claimHandleFor(first.id, "dylan");
    const second = await newUser("b@example.test");

    const result = await claimHandleFor(second.id, "DYLAN");

    expect((result as { error: string }).error).toMatch(/taken/i);
  });
});
