import { describe, expect, it } from "vitest";
import { getTripLifecyclePhase } from "./lifecyclePhase";

describe("getTripLifecyclePhase", () => {
  const refDate = new Date("2026-11-01T12:00:00Z");

  it("determines planning phase for future trip > 14 days away with rsvp_open", () => {
    const phase = getTripLifecyclePhase(
      {
        startsOn: "2026-11-20",
        endsOn: "2026-11-22",
        eventStatus: "rsvp_open",
      },
      refDate
    );
    expect(phase.phase).toBe("planning");
    expect(phase.defaultTab).toBe("overview");
    expect(phase.label).toBe("Planning & Quorum");
  });

  it("determines preparation phase for trip within 14 days of departure", () => {
    const phase = getTripLifecyclePhase(
      {
        startsOn: "2026-11-10",
        endsOn: "2026-11-12",
        eventStatus: "confirmed",
      },
      refDate
    );
    expect(phase.phase).toBe("preparation");
    expect(phase.defaultTab).toBe("prepare");
    expect(phase.label).toBe("Trip Preparation");
  });

  it("determines active_camping phase when in_progress status is set", () => {
    const phase = getTripLifecyclePhase(
      {
        startsOn: "2026-11-20",
        endsOn: "2026-11-22",
        eventStatus: "in_progress",
      },
      refDate
    );
    expect(phase.phase).toBe("active_camping");
    expect(phase.defaultTab).toBe("overview");
    expect(phase.badgeText).toBe("🏕️ Currently Camping");
  });

  it("determines active_camping phase when current date is between startsOn and endsOn", () => {
    const duringCampingDate = new Date("2026-11-21T14:00:00Z");
    const phase = getTripLifecyclePhase(
      {
        startsOn: "2026-11-20",
        endsOn: "2026-11-22",
        eventStatus: "confirmed",
      },
      duringCampingDate
    );
    expect(phase.phase).toBe("active_camping");
    expect(phase.badgeText).toBe("🏕️ Currently Camping");
  });

  it("determines post_trip phase when event is completed or finalized", () => {
    const phase = getTripLifecyclePhase(
      {
        startsOn: "2026-10-10",
        endsOn: "2026-10-12",
        eventStatus: "financially_finalized",
      },
      refDate
    );
    expect(phase.phase).toBe("post_trip");
    expect(phase.defaultTab).toBe("financials");
    expect(phase.label).toBe("Post-Trip Reconciliation");
  });

  it("determines post_trip phase when current date is after endsOn", () => {
    const postCampingDate = new Date("2026-11-25T12:00:00Z");
    const phase = getTripLifecyclePhase(
      {
        startsOn: "2026-11-20",
        endsOn: "2026-11-22",
        eventStatus: "confirmed",
      },
      postCampingDate
    );
    expect(phase.phase).toBe("post_trip");
    expect(phase.defaultTab).toBe("financials");
  });
});
