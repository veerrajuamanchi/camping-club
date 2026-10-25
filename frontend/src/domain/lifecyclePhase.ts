/**
 * Camping Club 2.0 — Lifecycle-Aware Presentation Engine
 * Pure domain logic mapping trip dates and status to one of four temporal phases:
 * 1. Planning (T-35d to T-14d): Prioritize Quorum, RSVP, Cabin Capacity.
 * 2. Preparation (T-14d to Day 0): Prioritize Chores, Carpools, Packing, Waivers.
 * 3. Active Camping (Day 0 to Day +2): Prioritize Offline GPS, Gate Code, Emergency Contacts.
 * 4. Post-Trip Reconciliation (Day +2 onwards): Prioritize Settlement, Transfer graph, Receipts.
 * 
 * Invariant: Never hide or remove tabs. All 4 destinations remain permanently accessible.
 */

export type LifecycleStage = "planning" | "preparation" | "active_camping" | "post_trip";

export interface TripLifecyclePhase {
  phase: LifecycleStage;
  label: string;
  badgeText?: string;
  defaultTab: "overview" | "prepare" | "activities" | "financials";
  focusCallout: string;
}

export interface TripLifecycleInput {
  startsOn?: string | null;
  endsOn?: string | null;
  eventStatus?: string | null;
  tripStatus?: string | null;
  pollDeadlineAt?: string | null;
}

export function getTripLifecyclePhase(
  trip: TripLifecycleInput,
  now: Date = new Date()
): TripLifecyclePhase {
  const status = (trip.tripStatus || trip.eventStatus || "").toLowerCase();

  // Phase 4: Post-Trip Reconciliation
  const postTripStatuses = ["completed", "financially_finalized", "financially_settled", "archived"];
  if (postTripStatuses.includes(status)) {
    return {
      phase: "post_trip",
      label: "Post-Trip Reconciliation",
      badgeText: "⚖️ Post-Trip Reconciliation",
      defaultTab: "financials",
      focusCallout: "Finalized peer settlement and receipt reconciliation are active.",
    };
  }

  if (trip.endsOn) {
    const endDateTime = new Date(`${trip.endsOn}T23:59:59Z`).getTime();
    if (now.getTime() > endDateTime) {
      return {
        phase: "post_trip",
        label: "Post-Trip Reconciliation",
        badgeText: "⚖️ Post-Trip Reconciliation",
        defaultTab: "financials",
        focusCallout: "Trip completed. Please review expenses and settle member balances.",
      };
    }
  }

  // Phase 3: Active Camping
  if (status === "in_progress") {
    return {
      phase: "active_camping",
      label: "Active Camping",
      badgeText: "🏕️ Currently Camping",
      defaultTab: "overview",
      focusCallout: "Currently on-site. Gate codes, campsite details, and emergency contacts are prioritized.",
    };
  }

  if (trip.startsOn && trip.endsOn) {
    const startDateTime = new Date(`${trip.startsOn}T00:00:00Z`).getTime();
    const endDateTime = new Date(`${trip.endsOn}T23:59:59Z`).getTime();
    const nowTime = now.getTime();
    if (nowTime >= startDateTime && nowTime <= endDateTime) {
      return {
        phase: "active_camping",
        label: "Active Camping",
        badgeText: "🏕️ Currently Camping",
        defaultTab: "overview",
        focusCallout: "Currently on-site. Gate codes, campsite details, and emergency contacts are prioritized.",
      };
    }
  }

  // Phase 2: Preparation & Readiness (T-14 Days to Day 0)
  if (trip.startsOn) {
    const startDateTime = new Date(`${trip.startsOn}T00:00:00Z`).getTime();
    const diffDays = (startDateTime - now.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays <= 14 && diffDays > 0) {
      return {
        phase: "preparation",
        label: "Trip Preparation",
        badgeText: "🎒 Trip Preparation",
        defaultTab: "prepare",
        focusCallout: "Departure approaching in under two weeks. Finalize carpool and duty assignments.",
      };
    }
    if (diffDays > 14) {
      return {
        phase: "planning",
        label: "Planning & Quorum",
        badgeText: "📋 Planning & Quorum",
        defaultTab: "overview",
        focusCallout: "RSVP window open. Confirm attendance and acknowledge club rules.",
      };
    }
  }

  if (status === "confirmed") {
    return {
      phase: "preparation",
      label: "Trip Preparation",
      badgeText: "🎒 Trip Preparation",
      defaultTab: "prepare",
      focusCallout: "Trip confirmed. Claim daily duties, organize carpools, and coordinate packing.",
    };
  }

  // Phase 1: Planning & Quorum
  return {
    phase: "planning",
    label: "Planning & Quorum",
    badgeText: "📋 Planning & Quorum",
    defaultTab: "overview",
    focusCallout: "RSVP window open. Confirm attendance and acknowledge club rules.",
  };
}
