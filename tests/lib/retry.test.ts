import { describe, it, expect, vi } from "vitest";
import { retryOnUniqueViolation } from "@/lib/retry";

function p2002() {
  return Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
}

describe("retryOnUniqueViolation", () => {
  it("returns the value when the function succeeds first time", async () => {
    await expect(retryOnUniqueViolation(async () => "ok")).resolves.toBe("ok");
  });

  it("retries after a unique violation and returns the second result", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(p2002())
      .mockResolvedValueOnce("second");

    await expect(retryOnUniqueViolation(fn)).resolves.toBe("second");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("rethrows errors that are not unique violations without retrying", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("connection refused"));

    await expect(retryOnUniqueViolation(fn)).rejects.toThrow("connection refused");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("gives up after the attempt limit and rethrows the violation", async () => {
    const fn = vi.fn().mockRejectedValue(p2002());

    await expect(retryOnUniqueViolation(fn, 3)).rejects.toMatchObject({ code: "P2002" });
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
