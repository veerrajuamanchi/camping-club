import { describe, it, expect } from "vitest";
import {
  evaluateDailyWorkloadProgress,
  evaluateFromDailyWorkload,
  resolveMemberActions,
  resolveAdminActions,
  resolveActionsForCalendarTrip,
  getTopPriorityAction,
  type TripContext,
  type MemberContext,
  type AdminEvaluationContext,
} from "./actionResolution";

describe("ActionResolutionService - Daily Workload Engine", () => {
  it("evaluates each day independently and prevents excess weight on one day from compensating for another", () => {
    // 3-day trip: 2026-11-13 (Fri) to 2026-11-15 (Sun)
    // Friday: 2.0x (Inbound Driver)
    // Saturday: 1.0x (Breakfast prep - missing 1.0x)
    // Sunday: 3.0x (Outbound Driver 2.0x + Camp cleanup 1.0x)
    // Total assigned: 6.0x. Target per day: 2.0x (Total 6.0x).
    const evaluation = evaluateDailyWorkloadProgress({
      startsOn: "2026-11-13",
      endsOn: "2026-11-15",
      dailyWorkloadTarget: 2.0,
      duties: [
        { slotDate: "2026-11-13", workloadWeight: 2.0, title: "Inbound Carpool Driver" },
        { slotDate: "2026-11-14", workloadWeight: 1.0, title: "Saturday Breakfast Prep" },
        { slotDate: "2026-11-15", workloadWeight: 2.0, title: "Outbound Carpool Driver" },
        { slotDate: "2026-11-15", workloadWeight: 1.0, title: "Camp Cleanup" },
      ],
    });

    expect(evaluation.isComplete).toBe(false);
    expect(evaluation.totalDays).toBe(3);
    expect(evaluation.completedDays).toBe(2);
    expect(evaluation.summaryLabel).toBe("Daily responsibilities: 2 of 3 days complete · Saturday needs 1.0×");
    expect(evaluation.days).toHaveLength(3);

    // Day 1: Friday
    expect(evaluation.days[0].date).toBe("2026-11-13");
    expect(evaluation.days[0].dayName).toBe("Friday");
    expect(evaluation.days[0].assignedWeight).toBe(2.0);
    expect(evaluation.days[0].targetWeight).toBe(2.0);
    expect(evaluation.days[0].isComplete).toBe(true);
    expect(evaluation.days[0].missingWeight).toBe(0);

    // Day 2: Saturday
    expect(evaluation.days[1].date).toBe("2026-11-14");
    expect(evaluation.days[1].dayName).toBe("Saturday");
    expect(evaluation.days[1].assignedWeight).toBe(1.0);
    expect(evaluation.days[1].targetWeight).toBe(2.0);
    expect(evaluation.days[1].isComplete).toBe(false);
    expect(evaluation.days[1].missingWeight).toBe(1.0);

    // Day 3: Sunday
    expect(evaluation.days[2].date).toBe("2026-11-15");
    expect(evaluation.days[2].dayName).toBe("Sunday");
    expect(evaluation.days[2].assignedWeight).toBe(3.0);
    expect(evaluation.days[2].targetWeight).toBe(2.0);
    expect(evaluation.days[2].isComplete).toBe(true);
    expect(evaluation.days[2].missingWeight).toBe(0);
  });

  it("marks responsibilities complete when all days satisfy the target independently", () => {
    const evaluation = evaluateDailyWorkloadProgress({
      startsOn: "2026-11-13",
      endsOn: "2026-11-15",
      dailyWorkloadTarget: 2.0,
      duties: [
        { slotDate: "2026-11-13", workloadWeight: 2.0, title: "Inbound Carpool Driver" },
        { slotDate: "2026-11-14", workloadWeight: 2.0, title: "Saturday Dinner Cook" },
        { slotDate: "2026-11-15", workloadWeight: 2.0, title: "Outbound Carpool Driver" },
      ],
    });

    expect(evaluation.isComplete).toBe(true);
    expect(evaluation.totalDays).toBe(3);
    expect(evaluation.completedDays).toBe(3);
    expect(evaluation.summaryLabel).toBe("Daily responsibilities: All 3 days complete (2.0× met)");
  });

  it("respects configured daily targets rather than hardcoding 2.0x", () => {
    const evaluation = evaluateDailyWorkloadProgress({
      startsOn: "2026-11-13",
      endsOn: "2026-11-14",
      dailyWorkloadTarget: 1.5,
      duties: [
        { slotDate: "2026-11-13", workloadWeight: 1.5, title: "Friday Cook" },
        { slotDate: "2026-11-14", workloadWeight: 1.0, title: "Saturday Helper" },
      ],
    });

    expect(evaluation.isComplete).toBe(false);
    expect(evaluation.totalDays).toBe(2);
    expect(evaluation.completedDays).toBe(1);
    expect(evaluation.summaryLabel).toBe("Daily responsibilities: 1 of 2 days complete · Saturday needs 0.5×");
  });

  it("handles trips with zero duties claiming correctly as all days deficient", () => {
    const evaluation = evaluateDailyWorkloadProgress({
      startsOn: "2026-11-13",
      endsOn: "2026-11-14",
      dailyWorkloadTarget: 2.0,
      duties: [],
    });

    expect(evaluation.isComplete).toBe(false);
    expect(evaluation.completedDays).toBe(0);
    expect(evaluation.summaryLabel).toBe("Daily responsibilities: 0 of 2 days complete · Friday needs 2.0×, Saturday needs 2.0×");
  });

  it("evaluates backend DailyWorkload object accurately matching user exact example", () => {
    // Friday: 2.0x, Saturday: 1.0x, Sunday: 3.0x
    const backendDailyWorkload = {
      target: 2.0,
      tripVersion: 1,
      satisfied: false,
      days: [
        { date: "2026-11-13", selectedWeight: 2.0, totalWeight: 4.0, remainingWeight: 2.0, eligibleSlots: 2, status: "target_met" as const },
        { date: "2026-11-14", selectedWeight: 1.0, totalWeight: 4.0, remainingWeight: 3.0, eligibleSlots: 3, status: "needs_selection" as const },
        { date: "2026-11-15", selectedWeight: 3.0, totalWeight: 4.0, remainingWeight: 1.0, eligibleSlots: 1, status: "target_met" as const },
      ],
    };

    const evaluation = evaluateFromDailyWorkload(backendDailyWorkload);
    expect(evaluation).not.toBeNull();
    expect(evaluation?.isComplete).toBe(false);
    expect(evaluation?.totalDays).toBe(3);
    expect(evaluation?.completedDays).toBe(2);
    expect(evaluation?.summaryLabel).toBe("Daily responsibilities: 2 of 3 days complete · Saturday needs 1.0×");
  });
});

describe("ActionResolutionService - Member Actions", () => {
  const baseTrip: TripContext = {
    tripId: "trip-nov-2026",
    title: "November Monterey Camping",
    monthKey: "2026-11",
    eventStatus: "confirmed",
    startsOn: "2026-11-13",
    endsOn: "2026-11-15",
    pollDeadlineAt: "2026-10-31T23:59:59Z",
    dailyWorkloadTarget: 2.0,
    requiresDeposit: true,
    hostName: "Manmohan",
  };

  it("generates missing RSVP action when member has not responded", () => {
    const member: MemberContext = {
      memberId: "mem-1",
      rsvpStatus: null,
      constitutionAcknowledged: false,
      depositStatus: "unsubmitted",
      claimedDuties: [],
      activities: [],
      settlementTransfers: [],
    };

    const actions = resolveMemberActions(baseTrip, member, "2026-10-25T12:00:00Z");
    const rsvpAction = actions.find((a) => a.ruleId === "ACT-MEM-RSVP");

    expect(rsvpAction).toBeDefined();
    expect(rsvpAction?.priority).toBe("critical");
    expect(rsvpAction?.title).toBe("Submit Trip RSVP");
    expect(rsvpAction?.actionUrl).toBe("/trips/trip-nov-2026?tab=overview");
  });

  it("generates Constitution acknowledgment action for confirmed attendee", () => {
    const member: MemberContext = {
      memberId: "mem-1",
      rsvpStatus: "going",
      constitutionAcknowledged: false,
      depositStatus: "unsubmitted",
      claimedDuties: [
        { slotDate: "2026-11-13", workloadWeight: 2.0, title: "Inbound Driver" },
        { slotDate: "2026-11-14", workloadWeight: 2.0, title: "Saturday Dinner" },
        { slotDate: "2026-11-15", workloadWeight: 2.0, title: "Outbound Driver" },
      ],
      activities: [],
      settlementTransfers: [],
    };

    const actions = resolveMemberActions(baseTrip, member, "2026-10-25T12:00:00Z");
    const constAction = actions.find((a) => a.ruleId === "ACT-MEM-CONST");

    expect(constAction).toBeDefined();
    expect(constAction?.priority).toBe("critical");
    expect(constAction?.title).toBe("Acknowledge Camping Constitution");
  });

  it("generates deposit action when deposit is unsubmitted", () => {
    const member: MemberContext = {
      memberId: "mem-1",
      rsvpStatus: "going",
      constitutionAcknowledged: true,
      depositStatus: "unsubmitted",
      claimedDuties: [
        { slotDate: "2026-11-13", workloadWeight: 2.0, title: "Inbound Driver" },
        { slotDate: "2026-11-14", workloadWeight: 2.0, title: "Saturday Dinner" },
        { slotDate: "2026-11-15", workloadWeight: 2.0, title: "Outbound Driver" },
      ],
      activities: [],
      settlementTransfers: [],
    };

    const actions = resolveMemberActions(baseTrip, member, "2026-10-25T12:00:00Z");
    const depAction = actions.find((a) => a.ruleId === "ACT-MEM-DEP");

    expect(depAction).toBeDefined();
    expect(depAction?.title).toBe("Submit $50 Cabin Deposit");
    expect(depAction?.reason).toContain("due to the cabin host (Manmohan)");
  });

  it("does not generate deposit action once deposit is submitted or verified", () => {
    const memberSubmitted: MemberContext = {
      memberId: "mem-1",
      rsvpStatus: "going",
      constitutionAcknowledged: true,
      depositStatus: "submitted",
      claimedDuties: [
        { slotDate: "2026-11-13", workloadWeight: 2.0, title: "Inbound Driver" },
        { slotDate: "2026-11-14", workloadWeight: 2.0, title: "Saturday Dinner" },
        { slotDate: "2026-11-15", workloadWeight: 2.0, title: "Outbound Driver" },
      ],
      activities: [],
      settlementTransfers: [],
    };

    const actions = resolveMemberActions(baseTrip, memberSubmitted, "2026-10-25T12:00:00Z");
    expect(actions.find((a) => a.ruleId === "ACT-MEM-DEP")).toBeUndefined();
  });

  it("generates daily responsibility action when one day is deficient", () => {
    const member: MemberContext = {
      memberId: "mem-1",
      rsvpStatus: "going",
      constitutionAcknowledged: true,
      depositStatus: "verified",
      claimedDuties: [
        { slotDate: "2026-11-13", workloadWeight: 2.0, title: "Inbound Driver" },
        { slotDate: "2026-11-14", workloadWeight: 1.0, title: "Saturday Breakfast" },
        { slotDate: "2026-11-15", workloadWeight: 2.0, title: "Outbound Driver" },
      ],
      activities: [],
      settlementTransfers: [],
    };

    const actions = resolveMemberActions(baseTrip, member, "2026-10-25T12:00:00Z");
    const respAction = actions.find((a) => a.ruleId === "ACT-MEM-RESP");

    expect(respAction).toBeDefined();
    expect(respAction?.title).toBe("Select Daily Responsibilities");
    expect(respAction?.explanationDetails).toBe("Daily responsibilities: 2 of 3 days complete · Saturday needs 1.0×");
    expect(respAction?.actionUrl).toBe("/trips/trip-nov-2026?tab=tasks");
  });

  it("generates waiver and voucher actions for opted-in activity attendees", () => {
    const member: MemberContext = {
      memberId: "mem-1",
      rsvpStatus: "going",
      constitutionAcknowledged: true,
      depositStatus: "verified",
      claimedDuties: [
        { slotDate: "2026-11-13", workloadWeight: 2.0, title: "Inbound Driver" },
        { slotDate: "2026-11-14", workloadWeight: 2.0, title: "Saturday Dinner" },
        { slotDate: "2026-11-15", workloadWeight: 2.0, title: "Outbound Driver" },
      ],
      activities: [
        {
          activityId: "act-gocar",
          activityName: "GoCar Monterey Tours",
          optedIn: true,
          voucherRequired: true,
          voucherCode: null,
          waiverRequired: true,
          waiverStatus: "none",
        },
      ],
      settlementTransfers: [],
    };

    const actions = resolveMemberActions(baseTrip, member, "2026-10-25T12:00:00Z");
    const vouchAction = actions.find((a) => a.ruleId === "ACT-MEM-VOUCH");
    const waivAction = actions.find((a) => a.ruleId === "ACT-MEM-WAIV");

    expect(vouchAction).toBeDefined();
    expect(vouchAction?.title).toBe("Enter Activity Voucher Code");
    expect(waivAction).toBeDefined();
    expect(waivAction?.title).toBe("Sign Tour Operator Waiver");
  });

  it("generates settlement payment action when member owes money post-trip", () => {
    const member: MemberContext = {
      memberId: "mem-1",
      rsvpStatus: "going",
      constitutionAcknowledged: true,
      depositStatus: "verified",
      claimedDuties: [],
      activities: [],
      settlementTransfers: [
        {
          transferId: "tx-101",
          direction: "send",
          amountCents: 3500,
          counterpartyName: "Manmohan",
          status: "pending",
        },
      ],
    };

    const pastTrip: TripContext = {
      ...baseTrip,
      eventStatus: "confirmed",
      startsOn: "2026-10-10",
      endsOn: "2026-10-12",
    };

    const actions = resolveMemberActions(pastTrip, member, "2026-10-25T12:00:00Z");
    const settleAction = actions.find((a) => a.ruleId === "ACT-MEM-SETTLE-SEND");

    expect(settleAction).toBeDefined();
    expect(settleAction?.title).toBe("Send Settlement Payment ($35.00)");
    expect(settleAction?.reason).toContain("Pay $35.00 to Manmohan");
  });
});

describe("ActionResolutionService - Admin Operations Actions", () => {
  it("generates prioritized exceptions for admin and accountant", () => {
    const adminCtx: AdminEvaluationContext = {
      pendingAccessRequests: [
        { memberId: "new-1", fullName: "Alice Smith", email: "alice@example.com" },
      ],
      trips: [
        {
          tripId: "trip-nov-2026",
          title: "November Monterey Camping",
          eventStatus: "tentative",
          pollDeadlineAt: "2026-10-28T23:59:59Z", // 3 days away
          startsOn: "2026-11-13",
          endsOn: "2026-11-15",
          cabinDeadlineAt: "2026-10-30T00:00:00Z", // 5 days away
          confirmedCount: 3,
          minimumParticipants: 4,
          submittedDeposits: [
            { memberId: "mem-2", memberName: "Bob Jones", amountCents: 5000, method: "Zelle" },
          ],
          unverifiedWaivers: [
            { memberId: "mem-3", memberName: "Carol White", activityName: "GoCar Monterey Tours" },
          ],
          waitlistedMembers: [
            { memberId: "mem-4", memberName: "David Green", position: 1 },
          ],
          unfinalizedSettlement: null,
        },
      ],
    };

    const adminActions = resolveAdminActions(adminCtx, "2026-10-25T12:00:00Z");

    // 1. Pending member access request
    expect(adminActions.find((a) => a.ruleId === "ACT-ADM-APPV")).toBeDefined();

    // 2. Approaching cutoff below minimum
    const cutoffAction = adminActions.find((a) => a.ruleId === "ACT-ADM-CUTOFF");
    expect(cutoffAction).toBeDefined();
    expect(cutoffAction?.priority).toBe("critical");

    // 3. Cabin deadline buffer alert
    const cabinAction = adminActions.find((a) => a.ruleId === "ACT-ADM-CABIN-CANCEL");
    expect(cabinAction).toBeDefined();
    expect(cabinAction?.priority).toBe("critical");

    // 4. Submitted deposit awaiting accountant verification
    const depAction = adminActions.find((a) => a.ruleId === "ACT-ADM-DEP-VERIF");
    expect(depAction).toBeDefined();
    expect(depAction?.audience).toBe("accountant");

    // 5. Unverified operator waiver
    const waivAction = adminActions.find((a) => a.ruleId === "ACT-ADM-WAIV-VERIF");
    expect(waivAction).toBeDefined();
  });
});

describe("ActionResolutionService - Helpers", () => {
  it("resolves actions for calendar trip with deficient Saturday daily workload", () => {
    const calendarTrip = {
      tripId: "trip-nov-2026",
      title: "November Monterey Camping",
      monthKey: "2026-11",
      eventStatus: "confirmed",
      startsOn: "2026-11-13",
      endsOn: "2026-11-15",
      pollDeadlineAt: "2026-10-31T23:59:59Z",
      depositStatus: "confirmed",
      myDailyWorkload: {
        target: 2.0,
        days: [
          { date: "2026-11-13", selectedWeight: 2.0, status: "target_met" },
          { date: "2026-11-14", selectedWeight: 1.0, status: "needs_selection" },
          { date: "2026-11-15", selectedWeight: 3.0, status: "target_met" },
        ],
      },
      myRsvp: { response: "coming" as const, acceptedRuleBundle: { contentHash: "hash-1", version: 1 } },
      currentRuleBundle: { contentHash: "hash-1", version: 1 },
    };

    const actions = resolveActionsForCalendarTrip(calendarTrip, "2026-10-25T12:00:00Z");
    expect(actions).toHaveLength(1);
    expect(actions[0].ruleId).toBe("ACT-MEM-RESP");
    expect(actions[0].explanationDetails).toBe("Daily responsibilities: 2 of 3 days complete · Saturday needs 1.0×");
  });

  it("correctly identifies the single top priority action", () => {
    const actions = [
      { id: "1", ruleId: "ACT-MEM-VOUCH", priority: "normal", title: "Voucher", actionUrl: "", reason: "", informationLevel: "review_recommended", audience: "member", sourceType: "", sourceId: "", completionCondition: "" },
      { id: "2", ruleId: "ACT-MEM-RSVP", priority: "critical", title: "RSVP", actionUrl: "", reason: "", informationLevel: "action_required", audience: "member", sourceType: "", sourceId: "", completionCondition: "" },
      { id: "3", ruleId: "ACT-MEM-DEP", priority: "high", title: "Deposit", actionUrl: "", reason: "", informationLevel: "action_required", audience: "member", sourceType: "", sourceId: "", completionCondition: "" },
    ];

    const top = getTopPriorityAction(actions as any);
    expect(top?.id).toBe("2");
    expect(top?.title).toBe("RSVP");
  });
});
