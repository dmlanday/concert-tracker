import { describe, it, expect } from "vitest";
import { handleSchema } from "@/lib/handle";

describe("handleSchema", () => {
  it.each(["dylan", "dyl_an", "a1b2c3", "abc"])("accepts %s", (h) => {
    expect(handleSchema.parse(h)).toBe(h);
  });

  it("lowercases input so /u/Dylan and /u/dylan cannot be different people", () => {
    expect(handleSchema.parse("Dylan")).toBe("dylan");
  });

  it("trims surrounding whitespace", () => {
    expect(handleSchema.parse("  dylan  ")).toBe("dylan");
  });

  it.each([
    ["ab", "too short"],
    ["a".repeat(31), "too long"],
    ["has space", "space"],
    ["has-hyphen", "hyphen"],
    ["emoji🎸", "emoji"],
    ["", "empty"],
  ])("rejects %s (%s)", (input) => {
    expect(() => handleSchema.parse(input)).toThrow();
  });

  it.each(["add", "events", "settings", "admin", "api", "u", "login"])(
    "rejects the reserved handle %s",
    (h) => {
      expect(() => handleSchema.parse(h)).toThrow(/reserved/i);
    },
  );

  it("rejects a reserved handle regardless of case", () => {
    expect(() => handleSchema.parse("Admin")).toThrow(/reserved/i);
  });
});
