import { describe, it, expect } from "vitest";
import { describeAttendance } from "@/domain/describe-attendance";

const base = {
  eventName: null,
  festivalName: null,
  venueName: "The Fillmore",
  city: "San Francisco",
  date: new Date("2026-06-13T00:00:00Z"),
};

describe("describeAttendance", () => {
  it("reads as 'Artist at Venue' for a single act night", () => {
    const result = describeAttendance({
      ...base,
      attendedArtistNames: ["Wednesday"],
      lineupSize: 1,
    });

    expect(result.title).toBe("Wednesday");
    expect(result.subtitle).toBe("The Fillmore, San Francisco");
    expect(result.isMultiAct).toBe(false);
  });

  it("still reads as a single act when the user caught one act of a larger bill", () => {
    const result = describeAttendance({
      ...base,
      attendedArtistNames: ["Wednesday"],
      lineupSize: 4,
    });

    expect(result.title).toBe("Wednesday");
    expect(result.isMultiAct).toBe(false);
  });

  it("lists the acts caught when there is more than one", () => {
    const result = describeAttendance({
      ...base,
      attendedArtistNames: ["MJ Lenderman", "Wednesday"],
      lineupSize: 2,
    });

    expect(result.title).toBe("MJ Lenderman, Wednesday");
    expect(result.isMultiAct).toBe(true);
  });

  it("prefers the event name as the title when one is set", () => {
    const result = describeAttendance({
      ...base,
      eventName: "Bonnaroo 2026, Day 2",
      attendedArtistNames: ["Wednesday", "MJ Lenderman", "Indigo De Souza"],
      lineupSize: 40,
    });

    expect(result.title).toBe("Bonnaroo 2026, Day 2");
    expect(result.subtitle).toContain("3 acts");
  });

  it("summarizes rather than listing when many acts were caught", () => {
    const result = describeAttendance({
      ...base,
      attendedArtistNames: ["A", "B", "C", "D", "E"],
      lineupSize: 40,
    });

    expect(result.title).toBe("A, B, C and 2 more");
  });

  it("handles an attendance with no acts ticked", () => {
    const result = describeAttendance({ ...base, attendedArtistNames: [], lineupSize: 3 });

    expect(result.title).toBe("The Fillmore");
    expect(result.isMultiAct).toBe(false);
  });
});
