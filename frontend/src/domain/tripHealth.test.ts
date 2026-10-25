import { describe, expect, it } from "vitest";
import { evaluateTripHealth, type TripHealthInput } from "./tripHealth";

describe("evaluateTripHealth", () => {
  const baseTrip: TripHealthInput = {
    tripId: "trip-uuid-1",
    title: "Russian River Spring Trip",
    startsOn: "2026-11-20",
    endsOn: "2026-11-22",
    pollDeadlineAt: "2026-11-06T23:59:59Z",
    contractualDeadlineAt: "2026-11-15T23:59:59Z",
    effectiveStatus: "confirmed",
    minParticipants: 4,
    confirmedAttendeeCount: 5,
    cabinBookingStatus: "booked",
    unverifiedDepositCount: 0,
    vacantDutyCount: 0,
    criticalDutyVacant: false,
    camperCount: 5,
    totalVehicleSeats: 6,
    missingVoucherCount: 0,
    unverifiedWaiverCount: 0,
    referenceDate: new Date("2026-11-01T12:00:00Z"),
  };

  it("classifies a fully satisfied trip as On Track", () => {
    const health = evaluateTripHealth(baseTrip);
    expect(health.status).toBe("on_track");
    expect(health.label).toBe("On Track");
    expect(health.badgeClass).toBe("badge-green");
    expect(health.reasons).toHaveLength(0);
  });

  describe("At Risk (Red) conditions", () => {
    it("triggers RISK-CABIN-DEADLINE when contractual deadline <= 5 days away and RSVPs < min", () => {
      const health = evaluateTripHealth({
        ...baseTrip,
        contractualDeadlineAt: "2026-11-04T12:00:00Z",
        referenceDate: new Date("2026-11-01T12:00:00Z"), // 3 days away
        confirmedAttendeeCount: 2,
        minParticipants: 4,
      });

      expect(health.status).toBe("at_risk");
      expect(health.label).toBe("At Risk");
      expect(health.badgeClass).toBe("badge-red");
      const reason = health.reasons.find((r) => r.conditionId === "RISK-CABIN-DEADLINE");
      expect(reason).toBeDefined();
      expect(reason?.message).toContain("only 2 RSVPs (minimum 4)");
      expect(reason?.actionRequired).toContain("Extend deadline, initiate outreach, or cancel cabin");
    });

    it("triggers RISK-CABIN-STATUS when confirmed trip has no_vacancy or cancelled cabin", () => {
      const health = evaluateTripHealth({
        ...baseTrip,
        effectiveStatus: "confirmed",
        cabinBookingStatus: "no_vacancy",
      });

      expect(health.status).toBe("at_risk");
      const reason = health.reasons.find((r) => r.conditionId === "RISK-CABIN-STATUS");
      expect(reason).toBeDefined();
      expect(reason?.message).toContain("cabin reservation has no vacancy or was cancelled");
      expect(reason?.actionRequired).toContain("Book alternative site or cancel trip");
    });

    it("triggers RISK-POST-CONF-DROP when trip was previously confirmed but attendance dropped below min", () => {
      const health = evaluateTripHealth({
        ...baseTrip,
        previousConfirmedState: true,
        confirmedAttendeeCount: 3,
        minParticipants: 4,
      });

      expect(health.status).toBe("at_risk");
      const reason = health.reasons.find((r) => r.conditionId === "RISK-POST-CONF-DROP");
      expect(reason).toBeDefined();
      expect(reason?.message).toContain("attendance dropped to 3 (below minimum 4)");
      expect(reason?.actionRequired).toContain("Admin proceed/cancel decision required");
    });

    it("triggers RISK-CRITICAL-DUTY when departure < 48 hours and critical duties are vacant", () => {
      const health = evaluateTripHealth({
        ...baseTrip,
        startsOn: "2026-11-03",
        referenceDate: new Date("2026-11-02T00:00:00Z"), // ~24h to departure
        criticalDutyVacant: true,
      });

      expect(health.status).toBe("at_risk");
      const reason = health.reasons.find((r) => r.conditionId === "RISK-CRITICAL-DUTY");
      expect(reason).toBeDefined();
      expect(reason?.message).toContain("Critical safety duties are unclaimed within 48 hours of departure");
      expect(reason?.actionRequired).toContain("Assign emergency duties in Admin Operations");
    });
  });

  describe("Needs Attention (Amber) conditions", () => {
    it("triggers WARN-REG-CUTOFF when cutoff <= 7 days away and RSVPs < min", () => {
      const health = evaluateTripHealth({
        ...baseTrip,
        pollDeadlineAt: "2026-11-05T12:00:00Z",
        referenceDate: new Date("2026-11-01T12:00:00Z"), // 4 days away
        confirmedAttendeeCount: 2,
        minParticipants: 4,
      });

      expect(health.status).toBe("needs_attention");
      expect(health.badgeClass).toBe("badge-amber");
      const reason = health.reasons.find((r) => r.conditionId === "WARN-REG-CUTOFF");
      expect(reason).toBeDefined();
      expect(reason?.message).toContain("Registration cutoff");
      expect(reason?.message).toContain("2 more RSVP(s) needed");
    });

    it("triggers WARN-UNVERIFIED-DEP when unverified deposits exist", () => {
      const health = evaluateTripHealth({
        ...baseTrip,
        unverifiedDepositCount: 2,
      });

      expect(health.status).toBe("needs_attention");
      const reason = health.reasons.find((r) => r.conditionId === "WARN-UNVERIFIED-DEP");
      expect(reason).toBeDefined();
      expect(reason?.message).toContain("2 member deposit(s) awaiting verification");
    });

    it("triggers WARN-CHORE-DEFICIT when trip departs in < 7 days and vacant duties remain", () => {
      const health = evaluateTripHealth({
        ...baseTrip,
        startsOn: "2026-11-06",
        referenceDate: new Date("2026-11-01T12:00:00Z"), // 5 days away
        vacantDutyCount: 3,
      });

      expect(health.status).toBe("needs_attention");
      const reason = health.reasons.find((r) => r.conditionId === "WARN-CHORE-DEFICIT");
      expect(reason).toBeDefined();
      expect(reason?.message).toContain("3 duty credit(s) remain unclaimed");
    });

    it("triggers WARN-CARPOOL-SEATS when camper count exceeds vehicle seat capacity", () => {
      const health = evaluateTripHealth({
        ...baseTrip,
        camperCount: 8,
        totalVehicleSeats: 5,
      });

      expect(health.status).toBe("needs_attention");
      const reason = health.reasons.find((r) => r.conditionId === "WARN-CARPOOL-SEATS");
      expect(reason).toBeDefined();
      expect(reason?.message).toContain("8 campers confirmed, but vehicles only provide 5 seats");
    });

    it("triggers WARN-VOUCHER-MISSING when opted-in campers are missing tour vouchers", () => {
      const health = evaluateTripHealth({
        ...baseTrip,
        missingVoucherCount: 2,
      });

      expect(health.status).toBe("needs_attention");
      const reason = health.reasons.find((r) => r.conditionId === "WARN-VOUCHER-MISSING");
      expect(reason).toBeDefined();
      expect(reason?.message).toContain("2 attendee(s) have not entered required tour voucher codes");
    });

    it("triggers WARN-WAIVER-PENDING when tour waivers are unverified", () => {
      const health = evaluateTripHealth({
        ...baseTrip,
        unverifiedWaiverCount: 1,
      });

      expect(health.status).toBe("needs_attention");
      const reason = health.reasons.find((r) => r.conditionId === "WARN-WAIVER-PENDING");
      expect(reason).toBeDefined();
      expect(reason?.message).toContain("1 tour liability waiver(s) unverified");
    });
  });

  describe("Fail Closed on Unknown / Stale Data Invariant", () => {
    it("fails closed to Needs Attention if cabin booking status is null or unknown", () => {
      const health = evaluateTripHealth({
        ...baseTrip,
        cabinBookingStatus: null,
      });

      expect(health.status).toBe("needs_attention");
      expect(health.status).not.toBe("on_track");
      const reason = health.reasons.find((r) => r.conditionId === "WARN-STALE-OR-UNKNOWN");
      expect(reason).toBeDefined();
      expect(reason?.message).toContain("Cabin booking status or critical trip readiness records are unconfirmed or stale");
    });

    it("fails closed to Needs Attention if cabin booking status is pending", () => {
      const health = evaluateTripHealth({
        ...baseTrip,
        cabinBookingStatus: "pending",
      });

      expect(health.status).toBe("needs_attention");
      expect(health.status).not.toBe("on_track");
    });

    it("prioritizes At Risk over Needs Attention when both triggers are present", () => {
      const health = evaluateTripHealth({
        ...baseTrip,
        cabinBookingStatus: "no_vacancy", // At risk
        unverifiedDepositCount: 2,        // Needs attention
      });

      expect(health.status).toBe("at_risk");
      expect(health.reasons.some((r) => r.conditionId === "RISK-CABIN-STATUS")).toBe(true);
      expect(health.reasons.some((r) => r.conditionId === "WARN-UNVERIFIED-DEP")).toBe(true);
    });
  });
});
