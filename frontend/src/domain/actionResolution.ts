export type ActionPriority = "critical" | "high" | "normal" | "info";

export type InformationLevel = 
  | "action_required"      // User must act to maintain status or unblock trip
  | "review_recommended"   // User should review, but not strictly blocking
  | "informational";       // Awareness only (e.g. packing list ready)

export type ActionAudience = "member" | "admin" | "accountant";

export interface ActionItem {
  id: string;                      // Deterministic ID: `${ruleId}:${tripId}:${entityId}`
  ruleId: string;                  // Canonical rule identifier (e.g. ACT-MEM-RESP)
  tripId?: string;                 // Linked trip ID (if trip-scoped)
  tripTitle?: string;              // Linked trip title or month name
  memberId?: string;               // Target member ID
  
  title: string;                   // Concise imperative title (e.g. "Select Responsibility")
  reason: string;                  // Clear explanation of why action exists
  explanationDetails?: string;     // Contextual breakdown (e.g. "2 of 3 days complete · Saturday needs 1.0×")
  
  priority: ActionPriority;        // Priority ordering
  informationLevel: InformationLevel;
  audience: ActionAudience;
  
  dueAt?: string;                  // ISO timestamp of deadline (if applicable)
  actionUrl: string;               // Deep link to exact resolution UI drawer/tab
  
  sourceType: string;              // Table name (e.g. "trip_duty_assignments")
  sourceId: string;                // Primary key of source record
  
  completionCondition: string;     // Evaluated condition that clears the action
}

export interface DayWorkloadDetail {
  date: string;
  dayName: string;
  assignedWeight: number;
  targetWeight: number;
  missingWeight: number;
  isComplete: boolean;
  duties: Array<{ title?: string; workloadWeight: number }>;
}

export interface DailyWorkloadEvaluation {
  isComplete: boolean;
  totalDays: number;
  completedDays: number;
  targetWeightPerDay: number;
  summaryLabel: string;
  days: DayWorkloadDetail[];
}

export interface DailyWorkloadInput {
  startsOn: string;
  endsOn: string;
  dailyWorkloadTarget?: number | null;
  duties: Array<{
    slotDate: string;
    workloadWeight: number;
    title?: string;
  }>;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Evaluates daily workload satisfaction from the backend DailyWorkload object.
 * Strictly prevents excess weight on one day from compensating for another.
 */
export function evaluateFromDailyWorkload(
  dailyWorkload: {
    target: number | null;
    days: Array<{
      date: string;
      selectedWeight: number;
      status?: string;
    }>;
  } | null | undefined,
  startsOn: string | null = null,
  endsOn: string | null = null
): DailyWorkloadEvaluation | null {
  if (!dailyWorkload && (!startsOn || !endsOn)) return null;

  const target = dailyWorkload?.target != null && dailyWorkload.target > 0
    ? Number(dailyWorkload.target)
    : 2.0;

  // Use days from dailyWorkload if available, or generate from date range
  let rawDays = dailyWorkload?.days ?? [];
  if (rawDays.length === 0 && startsOn && endsOn) {
    rawDays = enumerateDates(startsOn, endsOn).map((date) => ({
      date,
      selectedWeight: 0,
    }));
  }

  if (rawDays.length === 0) return null;

  const days: DayWorkloadDetail[] = rawDays.map((d) => {
    const dt = new Date(`${d.date}T12:00:00Z`);
    const dayName = DAY_NAMES[dt.getUTCDay()];
    const assignedWeight = Math.round(Number(d.selectedWeight || 0) * 10) / 10;
    const isComplete = assignedWeight >= target;
    const missingWeight = isComplete ? 0 : Math.round((target - assignedWeight) * 10) / 10;

    return {
      date: d.date,
      dayName,
      assignedWeight,
      targetWeight: target,
      missingWeight,
      isComplete,
      duties: [],
    };
  });

  const totalDays = days.length;
  const completedDays = days.filter((d) => d.isComplete).length;
  const isComplete = completedDays === totalDays && totalDays > 0;

  let summaryLabel = "";
  if (isComplete) {
    summaryLabel = `Daily responsibilities: All ${totalDays} days complete (${target.toFixed(1)}× met)`;
  } else {
    const missingDays = days.filter((d) => !d.isComplete);
    const missingDetails = missingDays
      .map((d) => `${d.dayName} needs ${d.missingWeight.toFixed(1)}×`)
      .join(", ");
    summaryLabel = `Daily responsibilities: ${completedDays} of ${totalDays} days complete · ${missingDetails}`;
  }

  return {
    isComplete,
    totalDays,
    completedDays,
    targetWeightPerDay: target,
    summaryLabel,
    days,
  };
}
function enumerateDates(startsOn: string, endsOn: string): string[] {
  const dates: string[] = [];
  const current = new Date(`${startsOn}T00:00:00Z`);
  const end = new Date(`${endsOn}T00:00:00Z`);

  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

/**
 * Evaluates daily workload satisfaction independently for each calendar date.
 * Strictly prevents excess weight on one day from compensating for another.
 */
export function evaluateDailyWorkloadProgress(input: DailyWorkloadInput): DailyWorkloadEvaluation {
  const target = input.dailyWorkloadTarget != null && input.dailyWorkloadTarget > 0
    ? Number(input.dailyWorkloadTarget)
    : 2.0;

  const dateList = enumerateDates(input.startsOn, input.endsOn);
  const totalDays = dateList.length;

  const days: DayWorkloadDetail[] = dateList.map((dateStr) => {
    const d = new Date(`${dateStr}T12:00:00Z`);
    const dayName = DAY_NAMES[d.getUTCDay()];
    
    const dayDuties = input.duties.filter((duty) => duty.slotDate === dateStr);
    const assignedWeight = dayDuties.reduce((sum, duty) => sum + Number(duty.workloadWeight || 0), 0);
    const roundedAssigned = Math.round(assignedWeight * 10) / 10;
    
    const isComplete = roundedAssigned >= target;
    const missingWeight = isComplete ? 0 : Math.round((target - roundedAssigned) * 10) / 10;

    return {
      date: dateStr,
      dayName,
      assignedWeight: roundedAssigned,
      targetWeight: target,
      missingWeight,
      isComplete,
      duties: dayDuties.map((duty) => ({ title: duty.title, workloadWeight: Number(duty.workloadWeight || 0) })),
    };
  });

  const completedDays = days.filter((d) => d.isComplete).length;
  const isTripComplete = completedDays === totalDays && totalDays > 0;

  let summaryLabel = "";
  if (isTripComplete) {
    summaryLabel = `Daily responsibilities: All ${totalDays} days complete (${target.toFixed(1)}× met)`;
  } else {
    const missingDays = days.filter((d) => !d.isComplete);
    const missingDetails = missingDays
      .map((d) => `${d.dayName} needs ${d.missingWeight.toFixed(1)}×`)
      .join(", ");
    summaryLabel = `Daily responsibilities: ${completedDays} of ${totalDays} days complete · ${missingDetails}`;
  }

  return {
    isComplete: isTripComplete,
    totalDays,
    completedDays,
    targetWeightPerDay: target,
    summaryLabel,
    days,
  };
}

export interface TripContext {
  tripId: string;
  title?: string | null;
  monthKey: string;
  eventStatus: "tentative" | "confirmed" | "cancelled";
  startsOn: string | null;
  endsOn: string | null;
  pollDeadlineAt: string | null;
  dailyWorkloadTarget?: number | null;
  requiresDeposit?: boolean;
  hostName?: string | null;
}

export interface MemberContext {
  memberId: string;
  rsvpStatus: "going" | "not_going" | null;
  constitutionAcknowledged: boolean;
  depositStatus?: "unsubmitted" | "submitted" | "verified" | null;
  claimedDuties: Array<{
    slotDate: string;
    workloadWeight: number;
    title?: string;
  }>;
  activities?: Array<{
    activityId: string;
    activityName: string;
    optedIn: boolean;
    voucherRequired: boolean;
    voucherCode?: string | null;
    waiverRequired: boolean;
    waiverStatus: "none" | "member_signed" | "operator_verified";
  }>;
  settlementTransfers?: Array<{
    transferId: string;
    direction: "send" | "receive";
    amountCents: number;
    counterpartyName: string;
    status: "pending" | "sent" | "confirmed";
  }>;
}

export interface AdminEvaluationContext {
  pendingAccessRequests: Array<{
    memberId: string;
    fullName: string;
    email: string;
  }>;
  trips: Array<{
    tripId: string;
    title: string;
    eventStatus: "tentative" | "confirmed" | "cancelled";
    pollDeadlineAt: string | null;
    startsOn: string | null;
    endsOn: string | null;
    cabinDeadlineAt?: string | null;
    confirmedCount: number;
    minimumParticipants: number;
    submittedDeposits: Array<{
      memberId: string;
      memberName: string;
      amountCents: number;
      method: string;
    }>;
    unverifiedWaivers: Array<{
      memberId: string;
      memberName: string;
      activityName: string;
    }>;
    waitlistedMembers: Array<{
      memberId: string;
      memberName: string;
      position: number;
    }>;
    unfinalizedSettlement?: {
      totalExpensesCents: number;
    } | null;
  }>;
}

/**
 * Resolves all outstanding action items for a given member on a trip.
 */
export function resolveMemberActions(
  trip: TripContext,
  member: MemberContext,
  nowIso: string = new Date().toISOString()
): ActionItem[] {
  const actions: ActionItem[] = [];
  const tripTitle = trip.title || `Camping Trip (${trip.monthKey})`;

  // If trip is cancelled, no actions needed
  if (trip.eventStatus === "cancelled") {
    return actions;
  }

  const now = new Date(nowIso);

  // 1. ACT-MEM-RSVP: Missing RSVP
  if (!member.rsvpStatus) {
    const deadline = trip.pollDeadlineAt ? new Date(trip.pollDeadlineAt) : null;
    const isPastDeadline = deadline ? now > deadline : false;
    
    if (!isPastDeadline) {
      const daysUntilDeadline = deadline ? Math.max(0, (deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : 999;
      actions.push({
        id: `ACT-MEM-RSVP:${trip.tripId}:${member.memberId}`,
        ruleId: "ACT-MEM-RSVP",
        tripId: trip.tripId,
        tripTitle,
        memberId: member.memberId,
        title: "Submit Trip RSVP",
        reason: "Your RSVP response is needed to confirm cabin capacity and team planning.",
        priority: daysUntilDeadline <= 7 ? "critical" : "high",
        informationLevel: "action_required",
        audience: "member",
        dueAt: trip.pollDeadlineAt ?? undefined,
        actionUrl: `/trips/${trip.tripId}?tab=overview`,
        sourceType: "trip_rsvps",
        sourceId: trip.tripId,
        completionCondition: "Submit Going or Not Going RSVP",
      });
    }
    return actions; // If not RSVP'd, other trip commitments do not yet apply
  }

  // If member responded "not_going", no further preparations required
  if (member.rsvpStatus === "not_going") {
    return actions;
  }

  // 2. ACT-MEM-CONST: Constitution Acknowledgment Required
  if (!member.constitutionAcknowledged) {
    actions.push({
      id: `ACT-MEM-CONST:${trip.tripId}:${member.memberId}`,
      ruleId: "ACT-MEM-CONST",
      tripId: trip.tripId,
      tripTitle,
      memberId: member.memberId,
      title: "Acknowledge Camping Constitution",
      reason: "The Camping Constitution must be reviewed and signed for confirmed trip participation.",
      priority: "critical",
      informationLevel: "action_required",
      audience: "member",
      actionUrl: `/trips/${trip.tripId}?tab=overview&action=sign-constitution`,
      sourceType: "member_rule_acknowledgments",
      sourceId: trip.tripId,
      completionCondition: "Sign Constitution acknowledgment",
    });
  }

  // 3. ACT-MEM-DEP: Mandatory $50 Cabin Deposit
  if (trip.requiresDeposit && member.depositStatus === "unsubmitted") {
    actions.push({
      id: `ACT-MEM-DEP:${trip.tripId}:${member.memberId}`,
      ruleId: "ACT-MEM-DEP",
      tripId: trip.tripId,
      tripTitle,
      memberId: member.memberId,
      title: "Submit $50 Cabin Deposit",
      reason: `Cabin deposit of $50.00 is due to the cabin host (${trip.hostName || "Host"}).`,
      priority: "high",
      informationLevel: "action_required",
      audience: "member",
      actionUrl: `/trips/${trip.tripId}?tab=payments&action=submit-deposit`,
      sourceType: "cabin_deposit_records",
      sourceId: trip.tripId,
      completionCondition: "Mark deposit transfer as submitted",
    });
  }

  // 4. ACT-MEM-RESP: Daily Responsibilities Completion
  if (trip.startsOn && trip.endsOn) {
    const workloadEval = evaluateDailyWorkloadProgress({
      startsOn: trip.startsOn,
      endsOn: trip.endsOn,
      dailyWorkloadTarget: trip.dailyWorkloadTarget,
      duties: member.claimedDuties,
    });

    if (!workloadEval.isComplete) {
      actions.push({
        id: `ACT-MEM-RESP:${trip.tripId}:${member.memberId}`,
        ruleId: "ACT-MEM-RESP",
        tripId: trip.tripId,
        tripTitle,
        memberId: member.memberId,
        title: "Select Daily Responsibilities",
        reason: "Every confirmed attendee must satisfy their daily workload target for each day of the trip.",
        explanationDetails: workloadEval.summaryLabel,
        priority: "high",
        informationLevel: "action_required",
        audience: "member",
        actionUrl: `/trips/${trip.tripId}?tab=tasks`,
        sourceType: "trip_duty_assignments",
        sourceId: trip.tripId,
        completionCondition: "Claim duties satisfying daily targets across all camping dates",
      });
    }
  }

  // 5. Activities: Vouchers and Waivers
  if (member.activities) {
    for (const act of member.activities) {
      if (!act.optedIn) continue;

      // Voucher
      if (act.voucherRequired && !act.voucherCode) {
        actions.push({
          id: `ACT-MEM-VOUCH:${trip.tripId}:${act.activityId}`,
          ruleId: "ACT-MEM-VOUCH",
          tripId: trip.tripId,
          tripTitle,
          memberId: member.memberId,
          title: "Enter Activity Voucher Code",
          reason: `Voucher redemption code required for ${act.activityName}.`,
          priority: "normal",
          informationLevel: "review_recommended",
          audience: "member",
          actionUrl: `/trips/${trip.tripId}?tab=activities&action=enter-voucher`,
          sourceType: "activity_vouchers",
          sourceId: act.activityId,
          completionCondition: "Submit valid voucher code",
        });
      }

      // Waiver
      if (act.waiverRequired && act.waiverStatus === "none") {
        actions.push({
          id: `ACT-MEM-WAIV:${trip.tripId}:${act.activityId}`,
          ruleId: "ACT-MEM-WAIV",
          tripId: trip.tripId,
          tripTitle,
          memberId: member.memberId,
          title: "Sign Tour Operator Waiver",
          reason: `Tour operator liability waiver is required for ${act.activityName} before departure.`,
          priority: "critical",
          informationLevel: "action_required",
          audience: "member",
          actionUrl: `/trips/${trip.tripId}?tab=activities&action=sign-waiver`,
          sourceType: "trip_activity_participants",
          sourceId: act.activityId,
          completionCondition: "Sign operator waiver",
        });
      }
    }
  }

  // 6. Post-Trip Settlement Transfers
  if (member.settlementTransfers) {
    for (const tx of member.settlementTransfers) {
      if (tx.direction === "send" && tx.status === "pending") {
        actions.push({
          id: `ACT-MEM-SETTLE-SEND:${trip.tripId}:${tx.transferId}`,
          ruleId: "ACT-MEM-SETTLE-SEND",
          tripId: trip.tripId,
          tripTitle,
          memberId: member.memberId,
          title: `Send Settlement Payment ($${(tx.amountCents / 100).toFixed(2)})`,
          reason: `Trip settlement finalized. Pay $${(tx.amountCents / 100).toFixed(2)} to ${tx.counterpartyName}.`,
          priority: "high",
          informationLevel: "action_required",
          audience: "member",
          actionUrl: `/trips/${trip.tripId}?tab=financials&action=mark-sent`,
          sourceType: "settlement_transfers",
          sourceId: tx.transferId,
          completionCondition: "Mark transfer as sent",
        });
      } else if (tx.direction === "receive" && tx.status === "sent") {
        actions.push({
          id: `ACT-MEM-SETTLE-RECV:${trip.tripId}:${tx.transferId}`,
          ruleId: "ACT-MEM-SETTLE-RECV",
          tripId: trip.tripId,
          tripTitle,
          memberId: member.memberId,
          title: `Confirm Received Payment ($${(tx.amountCents / 100).toFixed(2)})`,
          reason: `${tx.counterpartyName} sent $${(tx.amountCents / 100).toFixed(2)}. Confirm receipt of funds.`,
          priority: "normal",
          informationLevel: "action_required",
          audience: "member",
          actionUrl: `/trips/${trip.tripId}?tab=financials&action=confirm-received`,
          sourceType: "settlement_transfers",
          sourceId: tx.transferId,
          completionCondition: "Confirm receipt of funds",
        });
      }
    }
  }

  return sortActionsByPriority(actions);
}

/**
 * Resolves all administrative exceptions and intervention needs.
 */
export function resolveAdminActions(
  ctx: AdminEvaluationContext,
  nowIso: string = new Date().toISOString()
): ActionItem[] {
  const actions: ActionItem[] = [];
  const now = new Date(nowIso);

  // 1. ACT-ADM-APPV: Pending Member Access Requests
  for (const req of ctx.pendingAccessRequests) {
    actions.push({
      id: `ACT-ADM-APPV:${req.memberId}`,
      ruleId: "ACT-ADM-APPV",
      memberId: req.memberId,
      title: `Review Access Request: ${req.fullName}`,
      reason: `${req.fullName} (${req.email}) requested membership access.`,
      priority: "high",
      informationLevel: "action_required",
      audience: "admin",
      actionUrl: `/admin/members?filter=pending`,
      sourceType: "members",
      sourceId: req.memberId,
      completionCondition: "Approve or reject member request",
    });
  }

  // 2. Per-Trip Admin Exceptions
  for (const trip of ctx.trips) {
    if (trip.eventStatus === "cancelled") continue;

    // A. Approaching Cutoff Deadline & Below Minimum Quorum
    if (trip.pollDeadlineAt) {
      const deadline = new Date(trip.pollDeadlineAt);
      const daysUntilPoll = (deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      if (daysUntilPoll >= 0 && daysUntilPoll <= 5 && trip.confirmedCount < trip.minimumParticipants) {
        actions.push({
          id: `ACT-ADM-CUTOFF:${trip.tripId}`,
          ruleId: "ACT-ADM-CUTOFF",
          tripId: trip.tripId,
          tripTitle: trip.title,
          title: `Cutoff Imminent (${trip.confirmedCount}/${trip.minimumParticipants} Confirmed)`,
          reason: `Registration cutoff is in ${Math.ceil(daysUntilPoll)} day(s). Attendance is below minimum threshold of ${trip.minimumParticipants}.`,
          priority: "critical",
          informationLevel: "action_required",
          audience: "admin",
          actionUrl: `/trips/${trip.tripId}?tab=overview&action=trip-controls`,
          sourceType: "camping_trips",
          sourceId: trip.tripId,
          completionCondition: "Reach minimum participation or administer cutoff override",
        });
      }
    }

    // B. Cabin Cancellation Deadline Buffer Warning
    if (trip.cabinDeadlineAt) {
      const cabinDeadline = new Date(trip.cabinDeadlineAt);
      const daysUntilCabinDeadline = (cabinDeadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      if (daysUntilCabinDeadline >= 0 && daysUntilCabinDeadline <= 5 && trip.confirmedCount < trip.minimumParticipants) {
        actions.push({
          id: `ACT-ADM-CABIN-CANCEL:${trip.tripId}`,
          ruleId: "ACT-ADM-CABIN-CANCEL",
          tripId: trip.tripId,
          tripTitle: trip.title,
          title: `Contractual Cabin Deadline Warning (${Math.ceil(daysUntilCabinDeadline)}d remaining)`,
          reason: `Contractual cabin cancellation deadline is ${trip.cabinDeadlineAt.slice(0, 10)}. Cancel before penalty if quorum cannot be met.`,
          priority: "critical",
          informationLevel: "action_required",
          audience: "admin",
          actionUrl: `/trips/${trip.tripId}?tab=overview&action=trip-controls`,
          sourceType: "camping_trips",
          sourceId: trip.tripId,
          completionCondition: "Confirm cabin viability or execute timely cancellation",
        });
      }
    }

    // C. Submitted Deposits Awaiting Accountant Verification
    for (const dep of trip.submittedDeposits) {
      actions.push({
        id: `ACT-ADM-DEP-VERIF:${trip.tripId}:${dep.memberId}`,
        ruleId: "ACT-ADM-DEP-VERIF",
        tripId: trip.tripId,
        tripTitle: trip.title,
        memberId: dep.memberId,
        title: `Verify $50 Deposit: ${dep.memberName}`,
        reason: `${dep.memberName} submitted $50.00 deposit via ${dep.method}. Verify bank receipt.`,
        priority: "normal",
        informationLevel: "action_required",
        audience: "accountant",
        actionUrl: `/trips/${trip.tripId}?tab=financials&action=verify-deposit&memberId=${dep.memberId}`,
        sourceType: "cabin_deposit_records",
        sourceId: dep.memberId,
        completionCondition: "Confirm deposit verification",
      });
    }

    // D. Unverified Operator Waivers on Tour Call Sheet
    for (const waiv of trip.unverifiedWaivers) {
      actions.push({
        id: `ACT-ADM-WAIV-VERIF:${trip.tripId}:${waiv.memberId}`,
        ruleId: "ACT-ADM-WAIV-VERIF",
        tripId: trip.tripId,
        tripTitle: trip.title,
        memberId: waiv.memberId,
        title: `Verify Tour Waiver: ${waiv.memberName}`,
        reason: `${waiv.memberName} self-reported signing ${waiv.activityName} waiver. Confirm on operator call sheet.`,
        priority: "high",
        informationLevel: "action_required",
        audience: "admin",
        actionUrl: `/trips/${trip.tripId}?tab=activities&action=call-sheet`,
        sourceType: "trip_activity_participants",
        sourceId: waiv.memberId,
        completionCondition: "Verify waiver signature on operator roster",
      });
    }

    // E. Waitlist Promotion Opportunity
    if (trip.waitlistedMembers.length > 0) {
      const topWaitlist = trip.waitlistedMembers.sort((a, b) => a.position - b.position)[0];
      actions.push({
        id: `ACT-ADM-WAITLIST:${trip.tripId}:${topWaitlist.memberId}`,
        ruleId: "ACT-ADM-WAITLIST",
        tripId: trip.tripId,
        tripTitle: trip.title,
        memberId: topWaitlist.memberId,
        title: `Promote Waitlisted Camper: ${topWaitlist.memberName}`,
        reason: `${topWaitlist.memberName} is #${topWaitlist.position} on waitlist. Promote to confirmed attendee.`,
        priority: "normal",
        informationLevel: "action_required",
        audience: "admin",
        actionUrl: `/trips/${trip.tripId}?tab=overview&action=manage-roster`,
        sourceType: "trip_waitlist",
        sourceId: topWaitlist.memberId,
        completionCondition: "Promote camper or dismiss waitlist spot",
      });
    }

    // F. Finalize Trip Settlement
    if (trip.endsOn) {
      const tripEnd = new Date(`${trip.endsOn}T23:59:59Z`);
      if (now > tripEnd && trip.unfinalizedSettlement) {
        actions.push({
          id: `ACT-ADM-SETTLE-FINAL:${trip.tripId}`,
          ruleId: "ACT-ADM-SETTLE-FINAL",
          tripId: trip.tripId,
          tripTitle: trip.title,
          title: `Finalize Trip Settlement: ${trip.title}`,
          reason: `Trip ended on ${trip.endsOn}. Expenses total $${(trip.unfinalizedSettlement.totalExpensesCents / 100).toFixed(2)}. Finalize settlement run.`,
          priority: "normal",
          informationLevel: "action_required",
          audience: "admin",
          actionUrl: `/trips/${trip.tripId}?tab=financials&action=finalize-settlement`,
          sourceType: "settlement_runs",
          sourceId: trip.tripId,
          completionCondition: "Execute finalized settlement run",
        });
      }
    }
  }

  return sortActionsByPriority(actions);
}

/**
 * Resolves actions for a trip item directly from the TripCalendarPage Trip object.
 */
export function resolveActionsForCalendarTrip(
  trip: {
    tripId: string;
    title?: string | null;
    monthKey: string;
    eventStatus?: string;
    startsOn: string | null;
    endsOn: string | null;
    pollDeadlineAt: string | null;
    depositStatus?: string | null;
    myDailyWorkload?: {
      target: number | null;
      days: Array<{ date: string; selectedWeight: number; status?: string }>;
    } | null;
    myDutyCount?: number;
    taskQuotaTarget?: number;
    myRsvp?: {
      response: "coming" | "not_coming";
      acceptedRuleBundle?: { contentHash?: string; version: number } | null;
    } | null;
    myWaitlistPosition?: number | null;
    currentRuleBundle?: { contentHash?: string; version: number } | null;
    additionalInformation?: string;
  },
  nowIso: string = new Date().toISOString()
): ActionItem[] {
  const actions: ActionItem[] = [];
  const tripTitle = trip.title || trip.additionalInformation || `Camping Trip (${trip.monthKey})`;
  const now = new Date(nowIso);

  if (trip.eventStatus === "cancelled") {
    return actions;
  }

  // 1. Missing RSVP
  if (!trip.myRsvp && !trip.myWaitlistPosition) {
    const deadline = trip.pollDeadlineAt ? new Date(trip.pollDeadlineAt) : null;
    const isPastDeadline = deadline ? now > deadline : false;

    if (!isPastDeadline) {
      const daysUntil = deadline ? (deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24) : 999;
      actions.push({
        id: `ACT-MEM-RSVP:${trip.tripId}`,
        ruleId: "ACT-MEM-RSVP",
        tripId: trip.tripId,
        tripTitle,
        title: "Submit Trip RSVP",
        reason: "Your RSVP response is needed to plan cabin and campsite arrangements.",
        priority: daysUntil <= 7 ? "critical" : "high",
        informationLevel: "action_required",
        audience: "member",
        dueAt: trip.pollDeadlineAt ?? undefined,
        actionUrl: `/trips/${trip.tripId}`,
        sourceType: "trip_rsvps",
        sourceId: trip.tripId,
        completionCondition: "Submit Going or Not Going RSVP",
      });
    }
    return actions;
  }

  // If Not Going, no tasks required
  if (trip.myRsvp?.response === "not_coming") {
    return actions;
  }

  // Coming RSVP Checks
  if (trip.myRsvp?.response === "coming") {
    // 2. Constitution Acknowledgment
    if (trip.currentRuleBundle) {
      const acceptedHash = trip.myRsvp.acceptedRuleBundle?.contentHash;
      const currentHash = trip.currentRuleBundle.contentHash;
      if (!acceptedHash || acceptedHash !== currentHash) {
        actions.push({
          id: `ACT-MEM-CONST:${trip.tripId}`,
          ruleId: "ACT-MEM-CONST",
          tripId: trip.tripId,
          tripTitle,
          title: `Acknowledge Camping Constitution (v${trip.currentRuleBundle.version})`,
          reason: "An updated Camping Constitution bundle requires your signed acknowledgment.",
          priority: "critical",
          informationLevel: "action_required",
          audience: "member",
          actionUrl: `/trips/${trip.tripId}`,
          sourceType: "member_rule_acknowledgments",
          sourceId: trip.tripId,
          completionCondition: "Sign Constitution acknowledgment",
        });
      }
    }

    // 3. Cabin Deposit ($50)
    const isDepositExemptOrPaid =
      trip.depositStatus === "exempt" ||
      trip.depositStatus === "confirmed" ||
      trip.depositStatus === "confirmed_by_admin" ||
      trip.depositStatus === "submitted_by_member";

    if (!isDepositExemptOrPaid && trip.eventStatus !== "tentative") {
      actions.push({
        id: `ACT-MEM-DEP:${trip.tripId}`,
        ruleId: "ACT-MEM-DEP",
        tripId: trip.tripId,
        tripTitle,
        title: "Submit $50 Cabin Deposit",
        reason: "Cabin deposit of $50.00 is due to confirm your reservation spot.",
        priority: "high",
        informationLevel: "action_required",
        audience: "member",
        actionUrl: `/trips/${trip.tripId}?tab=financials`,
        sourceType: "cabin_deposit_records",
        sourceId: trip.tripId,
        completionCondition: "Submit deposit payment details",
      });
    }

    // 4. Daily Responsibilities
    if (trip.myDailyWorkload) {
      const workloadEval = evaluateFromDailyWorkload(trip.myDailyWorkload, trip.startsOn, trip.endsOn);
      if (workloadEval && !workloadEval.isComplete) {
        actions.push({
          id: `ACT-MEM-RESP:${trip.tripId}`,
          ruleId: "ACT-MEM-RESP",
          tripId: trip.tripId,
          tripTitle,
          title: "Select Daily Responsibilities",
          reason: "Every confirmed attendee must satisfy their daily workload target for each day of the trip.",
          explanationDetails: workloadEval.summaryLabel,
          priority: "high",
          informationLevel: "action_required",
          audience: "member",
          actionUrl: `/trips/${trip.tripId}?tab=tasks`,
          sourceType: "trip_duty_assignments",
          sourceId: trip.tripId,
          completionCondition: "Claim duties satisfying daily targets across all camping dates",
        });
      }
    } else if ((trip.myDutyCount ?? 0) < (trip.taskQuotaTarget ?? 2)) {
      actions.push({
        id: `ACT-MEM-RESP:${trip.tripId}`,
        ruleId: "ACT-MEM-RESP",
        tripId: trip.tripId,
        tripTitle,
        title: "Select Responsibilities",
        reason: `Target is ${trip.taskQuotaTarget ?? 2} shared duties per attendee.`,
        explanationDetails: `${trip.myDutyCount ?? 0} of ${trip.taskQuotaTarget ?? 2} chosen`,
        priority: "high",
        informationLevel: "action_required",
        audience: "member",
        actionUrl: `/trips/${trip.tripId}?tab=tasks`,
        sourceType: "trip_duty_assignments",
        sourceId: trip.tripId,
        completionCondition: "Select required duties",
      });
    }
  }

  return sortActionsByPriority(actions);
}

const PRIORITY_ORDER: Record<ActionPriority, number> = {
  critical: 4,
  high: 3,
  normal: 2,
  info: 1,
};

export function sortActionsByPriority(actions: ActionItem[]): ActionItem[] {
  return [...actions].sort((a, b) => {
    const diff = PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority];
    if (diff !== 0) return diff;
    if (a.dueAt && b.dueAt) {
      return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
    }
    return 0;
  });
}

export function getTopPriorityAction(actions: ActionItem[]): ActionItem | null {
  if (actions.length === 0) return null;
  return sortActionsByPriority(actions)[0];
}
