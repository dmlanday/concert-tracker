import { describe, it, expect } from "vitest";
import { normalizeName } from "@/lib/text";

describe("normalizeName", () => {
  it("lowercases and trims", () => {
    expect(normalizeName("  Wednesday  ")).toBe("wednesday");
  });

  it("collapses internal whitespace so spacing typos still dedupe", () => {
    expect(normalizeName("King  Gizzard\tand the\nLizard Wizard")).toBe(
      "king gizzard and the lizard wizard",
    );
  });

  it("is idempotent", () => {
    const once = normalizeName("The   National ");
    expect(normalizeName(once)).toBe(once);
  });

  it("returns an empty string for whitespace only input", () => {
    expect(normalizeName("   ")).toBe("");
  });
});
