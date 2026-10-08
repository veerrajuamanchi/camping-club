import { describe, expect, it } from "vitest";
import { defaultPollDeadlineDate, formatZonedDateTimeLocal, planMonthlyRotation } from "./calendar";

const sites = [
  { id: "1", name: "Del Monte", rotationPosition: 1 },
  { id: "2", name: "Wishon Cove", rotationPosition: 2 },
  { id: "3", name: "DeSabla", rotationPosition: 3 },
  { id: "4", name: "Almanor", rotationPosition: 4 },
  { id: "5", name: "Shasta", rotationPosition: 5 },
  { id: "6", name: "Britton", rotationPosition: 6 },
  { id: "7", name: "Pit River", rotationPosition: 7 },
];

describe("monthly campsite calendar", () => {
  it("generates a unique rolling year and repeats the seven-site round robin", () => {
    const months = Array.from({ length: 12 }, (_, index) => `2027-${String(index + 1).padStart(2, "0")}`);
    const assignments = planMonthlyRotation(months, sites, 1);

    expect(assignments).toHaveLength(12);
    expect(new Set(assignments.map(({ monthKey }) => monthKey)).size).toBe(12);
    expect(assignments.map(({ campsiteId }) => campsiteId)).toEqual([
      "1", "2", "3", "4", "5", "6", "7", "1", "2", "3", "4", "5",
    ]);
    expect(assignments.map(({ rotationPosition }) => rotationPosition)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 1, 2, 3, 4, 5,
    ]);
  });

  it("starts at an administrator-selected position without reordering the configured sequence", () => {
    const assignments = planMonthlyRotation(["2027-11", "2027-12"], sites, 3);
    expect(assignments.map(({ campsiteId }) => campsiteId)).toEqual(["3", "4"]);
  });

  it("rejects malformed rotations instead of silently assigning a duplicate site", () => {
    expect(() => planMonthlyRotation(["2027-11"], sites.slice(0, 6), 1)).toThrow(/seven active campsites/i);
    expect(() => planMonthlyRotation(["2027-11"], [...sites.slice(0, 6), { ...sites[6], rotationPosition: 6 }], 1)).toThrow(/unique rotation positions/i);
  });

  it("defaults a configured poll deadline to 35 calendar days before the trip start", () => {
    expect(defaultPollDeadlineDate("2027-06-18")).toBe("2027-05-14");
  });

  it("formats a stored instant as the trip's club-local wall clock time", () => {
    expect(formatZonedDateTimeLocal("2027-01-02T02:00:00Z", "America/Los_Angeles")).toBe("2027-01-01T18:00");
    expect(formatZonedDateTimeLocal("2027-07-02T01:00:00Z", "America/Los_Angeles")).toBe("2027-07-01T18:00");
  });
});
