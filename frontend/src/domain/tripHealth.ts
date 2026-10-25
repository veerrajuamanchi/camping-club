/**
 * Camping Club 2.0 — Deterministic Trip Health Engine
 * Evaluates aggregate operational, financial, and logistical readiness of an upcoming camping trip.
 * Rule-Based Discrete States: 'on_track' | 'needs_attention' | 'at_risk'
 * Fails closed to 'needs_attention' if data is missing or stale.
 */

export type HealthStatus = "on_track" | "needs_attention" | "at_risk";

export interface HealthReason {
  conditionId: string;
  category: "booking" | "attendance" | "duties" | "transport" | "activities" | "finance" | "data";
  message: string;
  actionRequired: string;
}

export interface TripHealthResult {
  status: HealthStatus;
  label: string;
  badgeClass: "badge-green" | "badge-amber" | "badge-red";
  summary: string;
  reasons: HealthReason[];
}

export interface TripHealthInput {
  tripId: string;
  title?: string | null;
  startsOn?: string | null;
  endsOn?: string | null;
  pollDeadlineAt?: string | null;
  contractualDeadlineAt?: string | null;
  effectiveStatus?: string;
  minParticipants?: number;
  confirmedAttendeeCount: number;
  previousConfirmedState?: boolean;
  cabinBookingStatus?: string | null;
  unverifiedDepositCount?: number;
  vacantDutyCount?: number;
  criticalDutyVacant?: boolean;
  camperCount?: number;
  totalVehicleSeats?: number;
  missingVoucherCount?: number;
  unverifiedWaiverCount?: number;
  referenceDate?: Date;
}

export function evaluateTripHealth(input: TripHealthInput): TripHealthResult {
  const reasons: HealthReason[] = [];
  const now = input.referenceDate ?? new Date();
  const minParticipants = input.minParticipants ?? 4;
  const confirmedAttendees = input.confirmedAttendeeCount;

  // 1. Evaluate At-Risk (Red) Conditions
  // 1.1 RISK-CABIN-DEADLINE: Contractual deadline within 5 days AND RSVPs < min
  if (input.contractualDeadlineAt) {
    const deadlineDate = new Date(input.contractualDeadlineAt);
    const diffMs = deadlineDate.getTime() - now.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    if (diffDays >= 0 && diffDays <= 5 && confirmedAttendees < minParticipants) {
      reasons.push({
        conditionId: "RISK-CABIN-DEADLINE",
        category: "booking",
        message: `Trip has only ${confirmedAttendees} RSVPs (minimum ${minParticipants}). Contractual cabin cancellation penalty applies after ${input.contractualDeadlineAt.slice(0, 10)}.`,
        actionRequired: "Extend deadline, initiate outreach, or cancel cabin before penalty.",
      });
    }
  }

  // 1.2 RISK-CABIN-STATUS: Trip is confirmed, but cabin booking status is no_vacancy or cancelled
  if (
    input.effectiveStatus === "confirmed" &&
    (input.cabinBookingStatus === "no_vacancy" || input.cabinBookingStatus === "cancelled")
  ) {
    reasons.push({
      conditionId: "RISIN-CABIN-STATUS",
      conditionIdAlias: "RISK-CABIN-STATUS",
      category: "booking",
      message: "Trip is marked Confirmed, but the cabin reservation has no vacancy or was cancelled.",
      actionRequired: "Book alternative site or cancel trip in Admin Controls.",
    } as any);
  }

  // 1.3 RISK-POST-CONF-DROP: Trip previously confirmed, but member withdrawals dropped attendance below minimum
  if (input.previousConfirmedState && confirmedAttendees < minParticipants) {
    reasons.push({
      conditionId: "RISK-POST-CONF-DROP",
      category: "attendance",
      message: `Confirmed attendance dropped to ${confirmedAttendees} (below minimum ${minParticipants}) following withdrawals.`,
      actionRequired: "Admin proceed/cancel decision required under Club Constitution.",
    });
  }

  // 1.4 RISK-CRITICAL-DUTY: Trip departs in < 48 hours AND critical safety duties are vacant
  if (input.startsOn && input.criticalDutyVacant) {
    const startDate = new Date(`${input.startsOn}T00:00:00Z`);
    const diffMs = startDate.getTime() - now.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);
    if (diffHours >= 0 && diffHours <= 48) {
      reasons.push({
        conditionId: "RISK-CRITICAL-DUTY",
        category: "duties",
        message: "Critical safety duties are unclaimed within 48 hours of departure.",
        actionRequired: "Assign emergency duties in Admin Operations.",
      });
    }
  }

  // Fix any alias key if used above
  for (const r of reasons) {
    if ((r as any).conditionIdAlias) {
      r.conditionId = (r as any).conditionIdAlias;
      delete (r as any).conditionIdAlias;
    }
  }

  // 2. Evaluate Needs-Attention (Amber) Conditions
  // 2.1 WARN-REG-CUTOFF: Cutoff within 7 days AND RSVPs < min
  if (input.pollDeadlineAt && confirmedAttendees < minParticipants) {
    const cutoffDate = new Date(input.pollDeadlineAt);
    const diffMs = cutoffDate.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays >= 0 && diffDays <= 7) {
      const spotsNeeded = minParticipants - confirmedAttendees;
      reasons.push({
        conditionId: "WARN-REG-CUTOFF",
        category: "attendance",
        message: `Registration cutoff is ${input.pollDeadlineAt.slice(0, 10)} (${diffDays} days remaining). ${spotsNeeded} more RSVP(s) needed.`,
        actionRequired: "Send reminder notice to members.",
      });
    }
  }

  // 2.2 WARN-UNVERIFIED-DEP: Confirmed attendees have submitted deposits awaiting accountant verification
  if ((input.unverifiedDepositCount ?? 0) > 0) {
    reasons.push({
      conditionId: "WARN-UNVERIFIED-DEP",
      category: "finance",
      message: `${input.unverifiedDepositCount} member deposit(s) awaiting verification by the club accountant.`,
      actionRequired: "Review bank receipts in Payments tab.",
    });
  }

  // 2.3 WARN-CHORE-DEFICIT: Trip departs in < 7 days AND vacant duty credits remain unassigned
  if (input.startsOn && (input.vacantDutyCount ?? 0) > 0) {
    const startDate = new Date(`${input.startsOn}T00:00:00Z`);
    const diffMs = startDate.getTime() - now.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    if (diffDays >= 0 && diffDays <= 7) {
      reasons.push({
        conditionId: "WARN-CHORE-DEFICIT",
        category: "duties",
        message: `${input.vacantDutyCount} duty credit(s) remain unclaimed across meal and camp duties.`,
        actionRequired: "Claim duties in Prepare tab.",
      });
    }
  }

  // 2.4 WARN-CARPOOL-SEATS: Confirmed campers exceed registered vehicle seat capacities
  if (
    input.camperCount != null &&
    input.totalVehicleSeats != null &&
    input.camperCount > input.totalVehicleSeats
  ) {
    reasons.push({
      conditionId: "WARN-CARPOOL-SEATS",
      category: "transport",
      message: `${input.camperCount} campers confirmed, but vehicles only provide ${input.totalVehicleSeats} seats.`,
      actionRequired: "Request additional drivers in Prepare tab.",
    });
  }

  // 2.5 WARN-VOUCHER-MISSING: Signature activity opted-in campers have missing redemption vouchers
  if ((input.missingVoucherCount ?? 0) > 0) {
    reasons.push({
      conditionId: "WARN-VOUCHER-MISSING",
      category: "activities",
      message: `${input.missingVoucherCount} attendee(s) have not entered required tour voucher codes.`,
      actionRequired: "Enter vouchers in Activities tab.",
    });
  }

  // 2.6 WARN-WAIVER-PENDING: Opted-in attendees have unverified operator liability waivers
  if ((input.unverifiedWaiverCount ?? 0) > 0) {
    reasons.push({
      conditionId: "WARN-WAIVER-PENDING",
      category: "activities",
      message: `${input.unverifiedWaiverCount} tour liability waiver(s) unverified on the operator call sheet.`,
      actionRequired: "Verify signatures on Tour Call Sheet.",
    });
  }

  // 2.7 WARN-STALE-OR-UNKNOWN: Unknown or unverified critical data fails closed to Needs Attention
  const isCabinUnknownOrPending =
    !input.cabinBookingStatus ||
    input.cabinBookingStatus === "pending" ||
    input.cabinBookingStatus === "not_booked";

  if (isCabinUnknownOrPending && !reasons.some((r) => r.conditionId === "RISK-CABIN-STATUS")) {
    reasons.push({
      conditionId: "WARN-STALE-OR-UNKNOWN",
      category: "data",
      message: "Cabin booking status or critical trip readiness records are unconfirmed or stale.",
      actionRequired: "Review and update trip records in Admin Controls.",
    });
  }

  // 3. Determine Overall Status & Summary
  const hasAtRisk = reasons.some((r) => r.conditionId.startsWith("RISK-"));
  if (hasAtRisk) {
    return {
      status: "at_risk",
      label: "At Risk",
      badgeClass: "badge-red",
      summary: `${reasons.filter((r) => r.conditionId.startsWith("RISK-")).length} critical risk item(s) require immediate admin remediation.`,
      reasons,
    };
  }

  if (reasons.length > 0) {
    return {
      status: "needs_attention",
      label: "Needs Attention",
      badgeClass: "badge-amber",
      summary: `${reasons.length} operational or readiness task(s) require attention.`,
      reasons,
    };
  }

  return {
    status: "on_track",
    label: "On Track",
    badgeClass: "badge-green",
    summary: "All operational, cabin, and duty requirements are on track.",
    reasons: [],
  };
}
