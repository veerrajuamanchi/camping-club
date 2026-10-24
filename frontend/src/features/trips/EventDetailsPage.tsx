import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useAuth } from "../../app/AuthProvider";
import { invokeTripApi, TripApiError } from "../../lib/supabase";
import { AdminTimeSlotManagerModal } from "./AdminTimeSlotManagerModal";
import { TripTasksAndMealsTab } from "./TripTasksAndMealsTab";
import { PostRsvpDutyModal } from "./PostRsvpDutyModal";
import { MealPreferencesModal, type MealSlotItem } from "./MealPreferencesModal";
import { ConfirmGoingModal } from "./ConfirmGoingModal";
import { dailyWorkloadLabel, type DailyWorkload } from "./DailyWorkloadProgress";
import { formatCabinBookingStatus } from "./TripCalendarPage";
import { TripLogisticsTab } from "./TripLogisticsTab";
import { TripFinancialsTab } from "./TripFinancialsTab";
import { TripActivitiesTab, ACTIVITY_CATEGORIES } from "./TripActivitiesTab";

type TripDetails = {
  tripId: string;
  monthKey: string;
  title?: string | null;
  eventStatus?: "tentative" | "confirmed" | "cancelled" | "rsvp_open" | "in_progress" | "completed" | "financially_finalized" | "financially_settled" | "archived";
  tripStatus?: "rsvp_open" | "confirmed" | "in_progress" | "completed" | "financially_finalized" | "financially_settled" | "archived" | "cancelled";
  tripMileageRateCents?: number;
  depositAmountCents?: number;
  cabinPayerMemberId?: string | null;
  depositStatus?: "unpaid" | "submitted_by_member" | "confirmed" | "confirmed_by_admin" | "exempt";
  rulesMarkdown?: string | null;
  commitmentsList?: Array<{
    id: string;
    tripId: string;
    category: string;
    itemName: string;
    quantityDescription: string | null;
    assignedMemberId: string | null;
    assignedMemberName: string | null;
    isCritical: boolean;
    masterGearId?: string | null;
    masterFoodId?: string | null;
    commitmentType?: "individual_pack" | "shared_volunteer";
    isActive?: boolean;
    isMine?: boolean;
  }>;
  commitments?: {
    individualPack: Array<any>;
    sharedVolunteer: Array<any>;
  };
  cabinReservation?: {
    id: string;
    status: string;
    reservation_reference?: string | null;
    provider_label?: string | null;
    paid_by_member_id?: string | null;
    reservation_amount_cents?: number;
    cabin_count?: number;
    per_cabin_capacity?: number;
    cancellation_notes?: string | null;
  } | null;
  campingType?: "cabin" | "tent" | "rv" | "boat";
  taskQuotaTarget?: number;
  myDutyCount?: number;
  myDailyWorkload?: DailyWorkload | null;
  pollStatus: "draft" | "open" | "closed";
  startsOn: string | null;
  endsOn: string | null;
  pollDeadlineAt?: string | null;
  clubTimezone?: string | null;
  minimumParticipants?: number;
  selectedCampsiteId?: string;
  cabinBookingStatus?: "booked" | "no_vacancy" | "sites_available" | "pending" | null;
  additionalInformation: string;
  comingCount: number;
  effectiveCapacity: number | null;
  spotsRemaining: number | null;
  waitlistCount: number;
  myWaitlistPosition: number | null;
  myRsvp: null | { response: "coming" | "not_coming"; version: number; acknowledgmentId: string | null; updatedAt: string; acceptedRuleBundle?: { version: number } | null };
  currentRuleBundle: null | { id: string; version: number; contentHash: string; rules: Array<{ stable_key: string; text: string; category?: string; structured_values: Record<string, unknown> }>; createdAt: string };
  campsite: null | {
    campsiteId: string;
    name: string;
    locationDescription: string;
    availabilityUrl: string | null;
    availabilityStatus?: string;
    availabilitySourceUrl?: string | null;
    estimatedRateCents?: number | null;
    cabinTypes?: string[];
    directions: string | null;
    cabinCapacity: number | null;
    reservationInstructions: string | null;
    imageUrl?: string | null;
    campHostName?: string | null;
    campHostPhone?: string | null;
    campFeatures?: string[];
    cabinInformation?: string | null;
    adminNotes?: string;
    version?: number;
  };
  perCabinCapacity: number;
  cabinCount: number | null;
  maxCapacity: number | null;
  participantEntries: Array<{ memberId: string; displayName: string; response: string; depositStatus?: string }>;
  waitlistEntries: Array<{ memberId: string; displayName: string; position: number; createdAt: string }>;
  allMemberEntries?: Array<{ memberId: string; displayName: string; response: string; version: number }>;
  myMealPreferences?: {
    id?: string;
    tripId?: string;
    memberId?: string;
    saturdayBeverage: "coffee" | "tea" | "none";
    sundayBeverage: "coffee" | "tea" | "none";
    defaultDiet: "vegetarian" | "non_vegetarian";
    mealChoices: Record<string, "veg" | "non_veg" | "skip">;
    allergiesNotes?: string | null;
    alcoholBeverages?: string[];
  } | null;
  mealHeadcounts?: {
    beverages: {
      saturday: { coffee: number; tea: number; none: number };
      sunday: { coffee: number; tea: number; none: number };
    };
    alcohol?: {
      beer: number;
      wine: number;
      liquor: number;
      byob: number;
      none: number;
    };
    meals: Array<{
      slotId: string;
      slotLabel: string;
      slotDate: string;
      vegCount: number;
      nonVegCount: number;
      skipCount: number;
      totalEating: number;
    }>;
  } | null;
  version: number;
};

type Tab = "overview" | "constitution" | "logistics" | "tasks" | "financials" | "activities";
export type TripApiType = <T = unknown>(action: string, input?: unknown) => Promise<T>;

export type TripActivityParticipant = {
  id: string;
  activity_id: string;
  member_id: string;
  status: "attending" | "opted_out";
  paired_with_member_id?: string | null;
  notes?: string | null;
  display_name?: string | null;
};

export type TripActivityItem = {
  id: string;
  trip_id: string;
  title: string;
  category?: string | null;
  image_url?: string | null;
  location_name?: string | null;
  address?: string | null;
  directions_url?: string | null;
  booking_url?: string | null;
  activity_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  unit_label?: string | null;
  unit_capacity?: number | null;
  opt_out_policy?: "locked_on_voucher" | "flexible" | null;
  is_pairings_locked?: boolean | null;
  participants?: TripActivityParticipant[];
  groups?: any[];
  swap_requests?: any[];
};

export function formatCompactActivitySchedule(
  dateStr?: string | null,
  startTime?: string | null,
  endTime?: string | null
): string {
  if (!dateStr) return "";
  const parts = dateStr.split("-").map(Number);
  let formattedDate = "";
  if (parts.length === 3) {
    formattedDate = new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])));
  } else {
    formattedDate = dateStr;
  }

  const formatT = (t?: string | null) => {
    if (!t) return "";
    const [hStr, mStr] = t.split(":");
    let h = parseInt(hStr, 10);
    const m = mStr ? mStr.slice(0, 2) : "00";
    if (isNaN(h)) return t;
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12;
    if (h === 0) h = 12;
    return `${h}:${m} ${ampm}`;
  };

  const formattedStart = formatT(startTime);
  const formattedEnd = formatT(endTime);

  if (formattedStart && formattedEnd) {
    return `${formattedDate} • ${formattedStart} – ${formattedEnd}`;
  }
  if (formattedStart) {
    return `${formattedDate} • ${formattedStart}`;
  }
  return formattedDate;
}

const constitutionGroups: Array<{ label: string; categories: string[] }> = [
  { label: "Travel & Cabin", categories: ["transport", "cabin"] },
  { label: "Food & Expenses", categories: ["expenses", "conduct"] },
  { label: "Lodging & Responsibilities", categories: ["lodging", "participation"] },
  { label: "Packing & Meals", categories: ["meals", "custom"] },
];

const campingTypes = [
  { value: "cabin", label: "Cabin" },
  { value: "tent", label: "Tent" },
  { value: "rv", label: "RV" },
  { value: "boat", label: "Boat" },
];

const eventStatuses = [
  { value: "rsvp_open", label: "RSVP Open" },
  { value: "tentative", label: "Tentative" },
  { value: "confirmed", label: "Confirmed" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
  { value: "financially_finalized", label: "Financially Finalized" },
  { value: "financially_settled", label: "Financially Settled" },
  { value: "archived", label: "Archived" },
  { value: "cancelled", label: "Cancelled" },
];

const cabinBookingStatuses = [
  { value: "not_booked", label: "Not Booked" },
  { value: "booked", label: "Booked" },
  { value: "pending", label: "Pending (sites available)" },
  { value: "sites_available", label: "Sites Available" },
  { value: "no_vacancy", label: "No Vacancy" },
  { value: "cancellation_requested", label: "Cancellation Requested" },
  { value: "cancellation_confirmed", label: "Cancellation Confirmed" },
  { value: "unresolved", label: "Unresolved" },
];

function monthName(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1)));
}

type Props = {
  isAdmin: boolean;
  currentMemberId?: string;
  api?: TripApiType;
  userRole?: "member" | "admin" | "accountant";
};
const defaultApi: TripApiType = (action, input) => invokeTripApi(action, input);

export function EventDetailsPage({ isAdmin, currentMemberId, api = defaultApi, userRole }: Props) {
  const { tripId } = useParams<{ tripId: string }>();
  const navigate = useNavigate();
  let authProfileMemberId = currentMemberId;
  let authProfileRole = userRole;
  try {
    const auth = useAuth();
    authProfileMemberId = auth?.profile?.memberId ?? currentMemberId;
    const resolvedRole = auth?.profile?.role ?? (auth?.membership?.status === "active" ? auth.membership.role : undefined);
    if (resolvedRole) {
      authProfileRole = resolvedRole;
    }
  } catch {
    // AuthProvider not present (e.g. isolated component unit tests)
  }
  const isAccountant = authProfileRole === "accountant";
  const canVerifyDeposit = isAdmin || isAccountant;
  const [details, setDetails] = useState<TripDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = searchParams.get("tab") as Tab | null;
  const validTabs: Tab[] = ["overview", "constitution", "logistics", "tasks", "financials", "activities"];
  const [tab, setTabState] = useState<Tab>(urlTab && validTabs.includes(urlTab) ? urlTab : "overview");

  useEffect(() => {
    const currentQueryTab = searchParams.get("tab") as Tab | null;
    if (currentQueryTab && validTabs.includes(currentQueryTab) && currentQueryTab !== tab) {
      setTabState(currentQueryTab);
    }
  }, [searchParams]);

  const setTab = (newTab: Tab) => {
    setTabState(newTab);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (newTab === "overview") {
        next.delete("tab");
      } else {
        next.set("tab", newTab);
      }
      return next;
    }, { replace: true });
  };

  const [rsvpChoice, setRsvpChoice] = useState<"coming" | "not_coming" | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [rsvpBusy, setRsvpBusy] = useState(false);
  const [rsvpError, setRsvpError] = useState<string | null>(null);
  const [waitlistedPosition, setWaitlistedPosition] = useState<number | null>(null);
  const [categoryMap, setCategoryMap] = useState<Record<string, string>>({});
  const [adminRosterMsg, setAdminRosterMsg] = useState<string | null>(null);
  const [showEditLogistics, setShowEditLogistics] = useState(false);
  const [showEditEventModal, setShowEditEventModal] = useState(false);
  const [showTimeSlotsModal, setShowTimeSlotsModal] = useState(false);
  const [showDutyPromptModal, setShowDutyPromptModal] = useState(false);
  const [depositBusy, setDepositBusy] = useState(false);
  const [depositMsg, setDepositMsg] = useState<string | null>(null);
  const [showPackingModal, setShowPackingModal] = useState(false);
  const [showMealModal, setShowMealModal] = useState(false);
  const [showConfirmGoingModal, setShowConfirmGoingModal] = useState(false);
  const [tripActivities, setTripActivities] = useState<TripActivityItem[]>([]);
  const [activityBusy, setActivityBusy] = useState(false);
  const [activityMsg, setActivityMsg] = useState<string | null>(null);
  const [isEditingActivityChoice, setIsEditingActivityChoice] = useState(false);
  const [activityImageError, setActivityImageError] = useState(false);

  async function refresh() {
    if (!tripId) return;
    setError(null);
    try {
      const [tripResult, constitutionResult, activitiesResult] = await Promise.all([
        api<TripDetails>("get_trip_details", { tripId }),
        Promise.resolve(api<{ definitions?: Array<{ stable_key: string; category: string }> }>("get_constitution", { tripId })).catch(() => null),
        Promise.resolve(api<{ activities?: TripActivityItem[] }>("get_trip_activities", { tripId })).catch(() => null),
      ]);
      setDetails(tripResult);
      if (constitutionResult?.definitions) {
        const mapping: Record<string, string> = {};
        for (const def of constitutionResult.definitions) {
          mapping[def.stable_key] = def.category;
        }
        setCategoryMap(mapping);
      }
      if (activitiesResult?.activities) {
        setTripActivities(activitiesResult.activities);
      } else {
        setTripActivities([]);
      }
    } catch (err: any) {
      console.error("Failed to load trip details:", err);
      setError("Could not load trip details. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleActivityParticipation(status: "attending" | "opted_out") {
    if (!primaryActivity || !details) return;
    setActivityBusy(true);
    setActivityMsg(null);
    try {
      await api("set_activity_participation", {
        tripId: details.tripId,
        activityId: primaryActivity.id,
        status,
      });
      setTripActivities((prev) =>
        prev.map((act) => {
          if (act.id !== primaryActivity.id) return act;
          const currentMemberIdVal = authProfileMemberId || "m1";
          const participants = act.participants || [];
          const existingIdx = participants.findIndex((p) =>
            authProfileMemberId ? p.member_id === authProfileMemberId : true
          );
          let updatedParticipants: TripActivityParticipant[];
          if (existingIdx >= 0) {
            updatedParticipants = [...participants];
            updatedParticipants[existingIdx] = {
              ...updatedParticipants[existingIdx],
              status,
            };
          } else {
            updatedParticipants = [
              ...participants,
              {
                id: `part-${Date.now()}`,
                activity_id: act.id,
                member_id: currentMemberIdVal,
                status,
              },
            ];
          }
          return { ...act, participants: updatedParticipants };
        })
      );
      setIsEditingActivityChoice(false);
      await refresh();
    } catch {
      setActivityMsg("Failed to update activity choice. Please try again.");
    } finally {
      setActivityBusy(false);
    }
  }

  async function handleSubmitDeposit() {
    if (!details) return;
    setDepositBusy(true);
    setDepositMsg(null);
    try {
      await api("submit_deposit", { tripId: details.tripId });
      await refresh();
      setDepositMsg("Deposit marked sent! Pending verification.");
    } catch {
      setDepositMsg("Failed to submit deposit. Please try again.");
    } finally {
      setDepositBusy(false);
    }
  }

  async function handleVerifyDeposit(memberId: string, status: "confirmed_by_admin" | "unpaid" | "exempt" = "confirmed_by_admin") {
    if (!details) return;
    setDepositBusy(true);
    setDepositMsg(null);
    try {
      await api("verify_deposit", {
        tripId: details.tripId,
        memberId,
        status,
      });
      await refresh();
      setDepositMsg(
        status === "confirmed_by_admin"
          ? "Deposit confirmed!"
          : status === "exempt"
          ? "Member marked as cabin payer (deposit exempt)."
          : "Deposit status reset to pending."
      );
    } catch {
      setDepositMsg("Failed to update deposit status.");
    } finally {
      setDepositBusy(false);
    }
  }

  async function handleSaveMealPreferences(prefs: {
    saturdayBeverage: string;
    sundayBeverage: string;
    defaultDiet: string;
    mealChoices: Record<string, string>;
    allergiesNotes?: string | null;
    alcoholBeverages: string[];
  }) {
    if (!details) return;
    await api("save_meal_preferences", {
      tripId: details.tripId,
      saturdayBeverage: prefs.saturdayBeverage,
      sundayBeverage: prefs.sundayBeverage,
      defaultDiet: prefs.defaultDiet,
      mealChoices: prefs.mealChoices,
      allergiesNotes: prefs.allergiesNotes ?? null,
      alcoholBeverages: prefs.alcoholBeverages,
    });
    await refresh();
  }

  const [packedItemIds, setPackedItemIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!tripId) return;
    try {
      const saved = localStorage.getItem(`packing_checked_${tripId}_${authProfileMemberId || "me"}`);
      setPackedItemIds(saved ? new Set(JSON.parse(saved)) : new Set());
    } catch {
      setPackedItemIds(new Set());
    }
  }, [tripId, authProfileMemberId]);

  function handleTogglePacked(idOrName: string) {
    if (!tripId) return;
    setPackedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(idOrName)) {
        next.delete(idOrName);
      } else {
        next.add(idOrName);
      }
      try {
        localStorage.setItem(
          `packing_checked_${tripId}_${authProfileMemberId || "me"}`,
          JSON.stringify([...next])
        );
      } catch {
        // ignore
      }
      return next;
    });
  }

  async function handleSyncTripCommitments() {
    if (!details) return;
    setLoading(true);
    try {
      await api("admin_sync_trip_commitments", { tripId: details.tripId });
      await refresh();
    } catch (err) {
      console.error("Failed to sync trip commitments:", err);
      setError("Failed to sync commitments from Master Catalog.");
    } finally {
      setLoading(false);
    }
  }

  async function handleAddPackingItem(itemName: string, quantityDescription?: string, category: string = "gear") {
    if (!details) return;
    await api("manage_trip_commitment", {
      tripId: details.tripId,
      action: "admin_create",
      itemName,
      quantityDescription: quantityDescription || null,
      category,
      commitmentType: "individual_pack",
    });
    await refresh();
  }

  async function handleDeletePackingItem(commitmentId: string) {
    if (!details) return;
    await api("manage_trip_commitment", {
      tripId: details.tripId,
      action: "admin_delete",
      commitmentId,
    });
    await refresh();
  }

  useEffect(() => {
    void refresh();
  }, [tripId]);

  useEffect(() => {
    setActivityImageError(false);
  }, [tripActivities[0]?.id, tripActivities[0]?.image_url]);

  async function submitRsvpWithChoice(choice: "coming" | "not_coming") {
    if (!details) return;
    setRsvpBusy(true);
    setRsvpError(null);
    try {
      const result = await api<{ waitlisted?: boolean; position?: number }>("submit_rsvp", {
        tripId: details.tripId,
        response: choice,
        expectedVersion: details.myRsvp?.version ?? 0,
        ...(choice === "coming" && details.currentRuleBundle
          ? { bundleId: details.currentRuleBundle.id, contentHash: details.currentRuleBundle.contentHash }
          : {}),
      });
      if (result?.waitlisted) {
        setWaitlistedPosition(result.position ?? null);
      } else {
        setWaitlistedPosition(null);
      }
      await refresh();
      if (choice === "coming" && !result?.waitlisted) {
        setShowDutyPromptModal(true);
      }
      setRsvpChoice(null);
      setAcknowledged(false);
      setShowConfirmGoingModal(false);
    } catch (err: unknown) {
      setRsvpError("Response could not be saved. Refresh and try again.");
      throw err;
    } finally {
      setRsvpBusy(false);
    }
  }

  async function submitRsvp() {
    if (!details || !rsvpChoice) return;
    if (rsvpChoice === "coming" && details.myRsvp?.response !== "coming") {
      if (!details.currentRuleBundle || !acknowledged) {
        setRsvpError("Acknowledge the Camping Constitution before selecting Going.");
        return;
      }
    }
    try {
      await submitRsvpWithChoice(rsvpChoice);
    } catch {
      // error handled in submitRsvpWithChoice
    }
  }

  async function handleDeleteEvent() {
    if (!details) return;
    const name = details.title || `${monthName(details.monthKey)} Camping`;
    const confirmed = window.confirm(
      `Are you sure you want to delete "${name}"? This action removes the event and will not recreate it.`
    );
    if (!confirmed) return;
    setLoading(true);
    try {
      await api("admin_delete_trip", {
        tripId: details.tripId,
        reason: `Administrator deleted event: ${name}`,
      });
      navigate("/");
    } catch (err: unknown) {
      const msg =
        err instanceof TripApiError && err.message && err.message !== "The trip request could not be completed."
          ? err.message
          : ((err as Error)?.message || "Could not delete this camping event.");
      setError(msg);
      setLoading(false);
    }
  }

  async function promoteFromWaitlist(memberId: string) {
    if (!details) return;
    setRsvpBusy(true);
    setRsvpError(null);
    try {
      await api("admin_promote_from_waitlist", {
        tripId: details.tripId,
        memberId,
        reason: "Administrator promoted from waitlist",
      });
      await refresh();
    } catch (err: unknown) {
      if (
        (err instanceof TripApiError && (err.status === 409 || err.code === "trip_at_capacity")) ||
        (err instanceof Error && /capacity/i.test(err.message))
      ) {
        setRsvpError("Could not promote member. The trip may be at capacity.");
      } else {
        setRsvpError("Could not promote member. Refresh and try again.");
      }
    } finally {
      setRsvpBusy(false);
    }
  }

  async function toggleAdminRoster(memberId: string, currentResponse: string, expectedVersion: number) {
    if (!details) return;
    const newResponse = currentResponse === "coming" ? "not_coming" : "coming";
    setRsvpBusy(true);
    setAdminRosterMsg(null);
    try {
      await api("admin_record_interest", {
        tripId: details.tripId,
        memberId,
        response: newResponse,
        expectedVersion,
        reason: `Administrator updated roster: marked ${newResponse === "coming" ? "Going" : "Not Going"}`,
      });
      await refresh();
      setAdminRosterMsg("Roster attendance updated.");
    } catch (err: unknown) {
      const serverMsg = err instanceof TripApiError ? err.message : (err as Error)?.message;
      if (serverMsg && /personally acknowledge/i.test(serverMsg)) {
        setAdminRosterMsg("Could not mark Going. This member has not yet personally acknowledged the Camping Constitution. They must log in, check the agreement, and click 'Confirm Going'.");
      } else {
        setAdminRosterMsg(newResponse === "coming"
          ? (serverMsg || "Could not mark Going. The member must have personally acknowledged the constitution, or poll is closed.")
          : "Could not update attendance. Try again.");
      }
    } finally {
      setRsvpBusy(false);
    }
  }

  if (loading) return <p role="status">Loading trip details…</p>;
  if (error || !details)
    return (
      <div className="card">
        <p role="alert">{error ?? "Trip not found."}</p>
        <button className="secondary-button" onClick={() => void refresh()}>
          Try again
        </button>
      </div>
    );

  const isDraft = details.pollStatus === "draft";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: details.clubTimezone ?? "America/Los_Angeles" }).format(new Date());
  const canChangeRsvp = details.pollStatus !== "draft" && details.eventStatus !== "cancelled" &&
    !!details.endsOn && details.endsOn >= today;
  const daysUntilTrip = details.startsOn ? (Date.parse(details.startsOn) - Date.parse(today)) / 86_400_000 : null;
  const showLateWithdrawalWarning = (details.myRsvp?.response === "coming" && rsvpChoice === "not_coming") &&
    daysUntilTrip !== null && daysUntilTrip >= 0 && daysUntilTrip <= 30;
  const isComing = details.myRsvp?.response === "coming";
  const isNotComing = details.myRsvp?.response === "not_coming";
  const confirmedAttendees = (details.participantEntries ?? [])
    .filter((p) => p.response === "coming")
    .map((p) => {
      const fallbackName = details.allMemberEntries?.find((m) => m.memberId === p.memberId)?.displayName;
      return {
        memberId: p.memberId,
        displayName: p.displayName?.trim() || fallbackName || "Camper",
      };
    });
  const rsvpStatusLabel = details.myWaitlistPosition
    ? "Waitlisted"
    : isComing
      ? "Going"
      : isNotComing
        ? "Not Going"
        : "No response";

  const isCabinPayer = details.cabinPayerMemberId === authProfileMemberId || details.depositStatus === "exempt";
  const depositStatus = isCabinPayer ? "exempt" : (details.depositStatus ?? "unpaid");
  const isDepositDone = isCabinPayer || depositStatus === "confirmed" || depositStatus === "confirmed_by_admin" || depositStatus === "submitted_by_member";
  const isChoresDone = Boolean(
    details.myDailyWorkload?.target != null
      ? details.myDailyWorkload.satisfied
      : (details.myDutyCount ?? 0) >= (details.taskQuotaTarget ?? 2)
  );

  const mealSlots: MealSlotItem[] = (details.mealHeadcounts?.meals ?? []).map((m) => ({
    id: m.slotId,
    label: m.slotLabel,
    date: m.slotDate,
  }));

  const prefs = details.myMealPreferences;
  const isMealsDone = isComing;

  const primaryActivity = tripActivities.length > 0 ? tripActivities[0] : null;
  const hasActivities = Boolean(primaryActivity);
  const totalRequiredCount = hasActivities ? 5 : 4;
  const myActivityParticipant = primaryActivity?.participants?.find((p) =>
    authProfileMemberId
      ? p.member_id === authProfileMemberId
      : (p.member_id === "m1" || (primaryActivity.participants && primaryActivity.participants.length === 1))
  );
  const isActivityDone = Boolean(
    myActivityParticipant &&
    (myActivityParticipant.status === "attending" || myActivityParticipant.status === "opted_out")
  );
  const canChangeActivity = !primaryActivity?.is_pairings_locked;

  let requiredCompletedCount = 0;
  if (isComing) requiredCompletedCount++;
  if (isDepositDone) requiredCompletedCount++;
  if (isChoresDone) requiredCompletedCount++;
  if (isMealsDone) requiredCompletedCount++;
  if (hasActivities && isComing && isActivityDone) requiredCompletedCount++;
  const satBev = prefs?.saturdayBeverage === "tea" ? "Tea" : prefs?.saturdayBeverage === "none" ? "None" : "Coffee";
  const sunBev = prefs?.sundayBeverage === "coffee" ? "Coffee" : prefs?.sundayBeverage === "none" ? "None" : "Tea";

  let mealVegCount = 0;
  let mealNonVegCount = 0;
  let mealSkipCount = 0;
  const mealList = details.mealHeadcounts?.meals ?? [];
  if (mealList.length > 0) {
    for (const m of mealList) {
      const choice = prefs?.mealChoices?.[m.slotId];
      if (choice === "skip") {
        mealSkipCount++;
      } else if (choice === "non_veg") {
        mealNonVegCount++;
      } else if (choice === "veg") {
        mealVegCount++;
      } else {
        if (prefs?.defaultDiet === "non_vegetarian") {
          mealNonVegCount++;
        } else {
          mealVegCount++;
        }
      }
    }
  } else {
    if (prefs?.defaultDiet === "non_vegetarian") {
      mealNonVegCount = 1;
    } else {
      mealVegCount = 1;
    }
  }

  let dietSummary = "Veg (All)";
  if (mealSkipCount > 0) {
    dietSummary = `Skipping ${mealSkipCount} ${mealSkipCount === 1 ? "meal" : "meals"}`;
  } else if (mealNonVegCount > 0 && mealVegCount > 0) {
    dietSummary = "Custom";
  } else if (mealNonVegCount > 0 && mealVegCount === 0) {
    dietSummary = "Non-Veg (All)";
  } else {
    dietSummary = "Veg (All)";
  }

  const alcs = prefs?.alcoholBeverages ?? [];
  let alcoholSummary = "No Alcohol";
  if (alcs.length > 0 && !alcs.includes("none")) {
    const labels: string[] = [];
    if (alcs.includes("beer")) labels.push("Beer");
    if (alcs.includes("wine")) labels.push("Wine");
    if (alcs.includes("liquor")) labels.push("Cocktails");
    if (alcs.includes("byob")) labels.push("BYOB");
    alcoholSummary = labels.length > 0 ? `Alcohol: ${labels.join(", ")}` : "No Alcohol";
  }
  const hasAlcohol = alcs.some((a) => a !== "none");
  const mealSummaryText = `Sat: ${satBev}, Sun: ${sunBev} · ${dietSummary} · ${alcoholSummary}`;

  const individualPackItems = details.commitments?.individualPack
    ?? details.commitmentsList?.filter((c) => c.commitmentType === "individual_pack" && c.isActive)
    ?? [];
  const packedCount = individualPackItems.filter((i) => packedItemIds.has(i.id || i.itemName)).length;
  const sharedVolunteerItems = details.commitments?.sharedVolunteer
    ?? details.commitmentsList?.filter((c) => c.commitmentType === "shared_volunteer" && c.isActive)
    ?? [];
  const FOOD_CATEGORIES = new Set(["food", "pantry", "produce", "dairy_meat", "bakery", "beverages", "campfire"]);
  const isFood = (c: any) => Boolean(c.masterFoodId || FOOD_CATEGORIES.has(c.category));
  const openFoodItems = sharedVolunteerItems.filter((c) => isFood(c) && !c.assignedMemberId);
  const myClaimedGear = sharedVolunteerItems.filter((c) => !isFood(c) && (c.assignedMemberId === authProfileMemberId || c.isMine));

  const groupedRules = constitutionGroups.map((group) => ({
    ...group,
    rules: (details.currentRuleBundle?.rules ?? []).filter((r) => {
      const cat = (r as { category?: string }).category ?? categoryMap[r.stable_key] ?? "custom";
      return group.categories.includes(cat);
    }),
  }));

  const tripTitle = details.title || details.additionalInformation || `${monthName(details.monthKey)} Camping`;
  const campsiteLocation = details.campsite
    ? `${details.campsite.name}${details.campsite.locationDescription ? ` · ${details.campsite.locationDescription}` : ""}`
    : "TBA";

  const effectiveStatus = details.tripStatus || details.eventStatus || "rsvp_open";
  const statusLabels: Record<string, string> = {
    rsvp_open: "RSVP Open",
    tentative: "Tentative",
    confirmed: "Confirmed",
    in_progress: "In Progress",
    completed: "Completed",
    financially_finalized: "Financially Finalized",
    financially_settled: "Financially Settled",
    archived: "Archived",
    cancelled: "Cancelled",
  };
  const eventStatusLabel = statusLabels[effectiveStatus] || (isDraft ? "Pending" : "RSVP Open");

  const formattedDeadlinePST = details.pollDeadlineAt
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Los_Angeles",
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      }).format(new Date(details.pollDeadlineAt))
    : null;

  const campingTypeLabel = details.campingType
    ? details.campingType.charAt(0).toUpperCase() + details.campingType.slice(1)
    : "Cabin";

  async function handleLifecycleTransition(nextStatus: string, reasonPrompt?: string) {
    if (!details) return;
    setLoading(true);
    try {
      await api("admin_transition_trip_lifecycle", {
        tripId: details.tripId,
        toStatus: nextStatus,
        reason: reasonPrompt || `Administrator advanced trip to ${nextStatus}`,
      });
      await refresh();
    } catch (err: unknown) {
      const msg = (err as Error)?.message || "Failed to transition trip lifecycle.";
      setError(msg);
      setLoading(false);
    }
  }

  return (
    <section className="event-details">
      <Link to="/" className="back-link">
        &larr; All camping events
      </Link>

      <div className="event-details-hero">
        <div>
          <h1 className="hero-title">{tripTitle}</h1>
          <p className="hero-subtitle">{campsiteLocation}</p>
          <div className="hero-badges">
            <span className="badge-pill" style={{ fontSize: "0.82rem", background: "#f3f4f6", color: "#374151" }}>
              🏕️ {campingTypeLabel}
            </span>
            <span className={`event-status-pill status-${effectiveStatus === "confirmed" ? "confirmed" : effectiveStatus === "cancelled" ? "closed" : isDraft ? "upcoming" : details.pollStatus}`}>
              Event Status: {eventStatusLabel}
            </span>
            <span className="badge-pill" style={{ fontSize: "0.82rem", background: "#f3f4f6", color: "#374151" }}>
              RSVP: {rsvpStatusLabel}
            </span>
            {isComing && <span className="status-badge-going">You're going</span>}
            {isComing && (
              details.myDailyWorkload?.target != null ? (
                <button type="button" className="badge-pill" onClick={() => setTab("tasks")}>{dailyWorkloadLabel(details.myDailyWorkload)}</button>
              ) : (details.myDutyCount ?? 0) >= (details.taskQuotaTarget ?? 2) ? (
                <span
                  className="badge-pill"
                  style={{ background: "#dcfce7", color: "#166534", fontWeight: 600, fontSize: "0.82rem" }}
                >
                  ✓ Duties: {details.myDutyCount ?? 0}/{details.taskQuotaTarget ?? 2}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setTab("tasks")}
                  className="badge-pill"
                  style={{
                    background: "#fef3c7",
                    color: "#92400e",
                    fontWeight: 600,
                    fontSize: "0.82rem",
                    border: "1px solid #fde68a",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.25rem",
                  }}
                >
                  ⚠️ Duties: {details.myDutyCount ?? 0} of {details.taskQuotaTarget ?? 2} selected · Choose Duties &rarr;
                </button>
              )
            )}
            {isNotComing && <span className="status-badge-not-going">Not going</span>}
            {details.myWaitlistPosition && (
              <span className="status-badge-not-going">Waitlist #{details.myWaitlistPosition}</span>
            )}
            {isAdmin && (
              <div style={{ display: "flex", gap: "0.4rem", marginLeft: "auto", flexWrap: "wrap", alignItems: "center" }}>
                {(effectiveStatus === "rsvp_open" || effectiveStatus === "tentative") && (
                  <button
                    type="button"
                    className="primary-button"
                    style={{ fontSize: "0.85rem", padding: "0.25rem 0.65rem" }}
                    onClick={() => void handleLifecycleTransition("confirmed")}
                  >
                    ✓ Confirm Trip
                  </button>
                )}
                {effectiveStatus === "confirmed" && (
                  <button
                    type="button"
                    className="primary-button"
                    style={{ fontSize: "0.85rem", padding: "0.25rem 0.65rem", background: "#2563eb" }}
                    onClick={() => void handleLifecycleTransition("in_progress")}
                  >
                    🚀 Start Trip
                  </button>
                )}
                {effectiveStatus === "in_progress" && (
                  <button
                    type="button"
                    className="primary-button"
                    style={{ fontSize: "0.85rem", padding: "0.25rem 0.65rem", background: "#059669" }}
                    onClick={() => void handleLifecycleTransition("completed")}
                  >
                    🏁 Complete Trip
                  </button>
                )}
                {effectiveStatus === "completed" && (
                  <button
                    type="button"
                    className="primary-button"
                    style={{ fontSize: "0.85rem", padding: "0.25rem 0.65rem", background: "#7c3aed" }}
                    onClick={() => void handleLifecycleTransition("financially_finalized")}
                  >
                    🔒 Finalize Finances
                  </button>
                )}
                {effectiveStatus === "financially_finalized" && (
                  <button
                    type="button"
                    className="primary-button"
                    style={{ fontSize: "0.85rem", padding: "0.25rem 0.65rem", background: "#16a34a" }}
                    onClick={() => void handleLifecycleTransition("financially_settled")}
                  >
                    ✅ Settle Balances
                  </button>
                )}
                {effectiveStatus === "financially_settled" && (
                  <button
                    type="button"
                    className="secondary-button"
                    style={{ fontSize: "0.85rem", padding: "0.25rem 0.65rem" }}
                    onClick={() => void handleLifecycleTransition("archived")}
                  >
                    📦 Archive Trip
                  </button>
                )}
                <button
                  type="button"
                  className="secondary-button"
                  style={{ fontSize: "0.85rem", padding: "0.25rem 0.65rem" }}
                  onClick={() => setShowEditEventModal(true)}
                >
                  ✏️ Edit Event
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  style={{ fontSize: "0.85rem", padding: "0.25rem 0.65rem" }}
                  onClick={() => setShowTimeSlotsModal(true)}
                >
                  🍽️ Manage Meals &amp; Chores
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  style={{ fontSize: "0.85rem", padding: "0.25rem 0.65rem", color: "#dc2626", borderColor: "#fca5a5" }}
                  onClick={() => void handleDeleteEvent()}
                >
                  🗑️ Delete
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="hero-info-list">
          {details.startsOn && details.endsOn ? (
            <div className="hero-info-item">
              <span>📅</span>
              <strong>{details.startsOn} – {details.endsOn} (Pacific Time)</strong>
            </div>
          ) : (
            <div className="hero-info-item">
              <span>📅</span>
              <strong>Dates TBA</strong>
            </div>
          )}
          {formattedDeadlinePST && (
            <div className="hero-info-item">
              <span>⏰</span>
              <span>Registration deadline: {formattedDeadlinePST}</span>
            </div>
          )}
          {details.campsite?.locationDescription && (
            <div className="hero-info-item">
              <span>📍</span>
              <span>Campsite Address: {details.campsite.locationDescription}</span>
            </div>
          )}
          <div className="hero-info-item">
            <span>🏕️</span>
            <span>
              {details.cabinCount != null ? `${details.cabinCount} ${campingTypeLabel.toLowerCase()} ${details.cabinCount === 1 ? "site" : "sites"} (${formatCabinBookingStatus(details.cabinBookingStatus)}) · ` : ""}
              {details.perCabinCapacity} people per site
              {details.effectiveCapacity != null ? ` (${details.effectiveCapacity} total spots)` : ""}
            </span>
            {details.effectiveCapacity != null && <span className="sr-only">Capacity: {details.effectiveCapacity}</span>}
          </div>
          {details.minimumParticipants != null && details.eventStatus !== "confirmed" && (
            <div className="hero-info-item">
              <span>👥</span>
              <span>Minimum participants required: {details.minimumParticipants}</span>
            </div>
          )}
        </div>

        <div className="metric-boxes-grid">
          <div className="metric-box-card">
            <p className="metric-value">{details.comingCount}</p>
            <p className="metric-label">Going</p>
            <span className="sr-only">{details.comingCount} confirmed</span>
          </div>
          <div className="metric-box-card">
            <p className="metric-value">{details.spotsRemaining ?? "—"}</p>
            <p className="metric-label">Spots left</p>
            {details.spotsRemaining != null && <span className="sr-only">{details.spotsRemaining} spots remaining</span>}
          </div>
          <div className="metric-box-card">
            <p className="metric-value">{details.waitlistCount}</p>
            <p className="metric-label">Waitlisted</p>
          </div>
        </div>
      </div>

      <div className="event-tabs" role="tablist" aria-label="Trip sections">
        {(["overview", "constitution", "logistics", "tasks", "financials", "activities"] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={tab === t ? "active" : ""}
            onClick={() => setTab(t)}
          >
            {t === "overview" && "Overview & attendees"}
            {t === "constitution" && "Camping Constitution"}
            {t === "logistics" && "Logistics & Packing"}
            {t === "tasks" && "Tasks & Meals"}
            {t === "financials" && "Financials"}
            {t === "activities" && "🎯 Activities"}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="stack">
          {/* Section 1: ⚡ REQUIRED FROM YOU */}
          <div
            className="card"
            style={{
              background: details.myRsvp?.response === "not_coming" ? "#f8fafc" : requiredCompletedCount === totalRequiredCount ? "#f0fdf4" : "#fffbeb",
              border: `1.5px solid ${details.myRsvp?.response === "not_coming" ? "#cbd5e1" : requiredCompletedCount === totalRequiredCount ? "#86efac" : "#f59e0b"}`,
              padding: "1rem 1.25rem",
              borderRadius: "10px",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "0.85rem",
                flexWrap: "wrap",
                gap: "0.5rem",
              }}
            >
              <h2
                style={{
                  margin: 0,
                  fontWeight: 700,
                  color: details.myRsvp?.response === "not_coming" ? "#475569" : requiredCompletedCount === totalRequiredCount ? "#166534" : "#92400e",
                  fontSize: "1.05rem",
                  letterSpacing: "0.3px",
                }}
              >
                {details.myRsvp?.response === "not_coming"
                  ? "⚡ Required From You"
                  : `⚡ Required From You (${requiredCompletedCount} of ${totalRequiredCount} Completed)`}
              </h2>
              <span
                style={{
                  background: details.myRsvp?.response === "not_coming" ? "#f1f5f9" : requiredCompletedCount === totalRequiredCount ? "#dcfce7" : "#fef3c7",
                  color: details.myRsvp?.response === "not_coming" ? "#64748b" : requiredCompletedCount === totalRequiredCount ? "#15803d" : "#b45309",
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  padding: "3px 8px",
                  borderRadius: "4px",
                }}
              >
                {details.myRsvp?.response === "not_coming"
                  ? "Not Attending"
                  : requiredCompletedCount === totalRequiredCount
                  ? "All Done ✓"
                  : "Action Needed"}
              </span>
            </div>

            {details.myRsvp?.response === "not_coming" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                <div
                  data-testid="hub-rsvp-row"
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    background: "#ffffff",
                    padding: "0.6rem 0.85rem",
                    borderRadius: "8px",
                    border: "1px solid #cbd5e1",
                    gap: "0.75rem",
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <span style={{ color: "#64748b", fontWeight: 700, marginRight: "0.35rem" }}>—</span>
                    <strong>RSVP Status</strong>:{" "}
                    <span style={{ color: "#64748b", fontWeight: 600 }}>Not Going</span>
                  </div>
                  <div>
                    {canChangeRsvp && (
                      <button
                        type="button"
                        className="secondary-button"
                        style={{ fontSize: "0.8rem", padding: "0.25rem 0.6rem" }}
                        onClick={() => {
                          setShowConfirmGoingModal(true);
                          setRsvpChoice("coming");
                        }}
                      >
                        Change
                      </button>
                    )}
                  </div>
                </div>
                <p style={{ margin: "0.25rem 0 0", fontSize: "0.875rem", color: "#64748b" }}>
                  You're not attending this event. No tasks or deposits required.
                </p>
              </div>
            ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
              {/* Item 1: RSVP */}
              <div
                data-testid="hub-rsvp-row"
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  background: "#ffffff",
                  padding: "0.6rem 0.85rem",
                  borderRadius: "8px",
                  border: `1px solid ${isComing ? "#86efac" : "#fde68a"}`,
                  gap: "0.75rem",
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <span style={{ color: isComing ? "#16a34a" : "#d97706", fontWeight: 700, marginRight: "0.35rem" }}>
                    {isComing ? "✓" : "⚠️"}
                  </span>
                  <strong>RSVP Status</strong>:{" "}
                  <span style={{ color: isComing ? "#16a34a" : "#b45309", fontWeight: 600 }}>
                    {rsvpStatusLabel}
                  </span>
                </div>
                <div>
                  {canChangeRsvp && (
                    <button
                      type="button"
                      className="secondary-button"
                      style={{ fontSize: "0.8rem", padding: "0.25rem 0.6rem" }}
                      onClick={() => {
                        if (isComing) {
                          const rsvpEl = document.getElementById("rsvp-actions-card");
                          if (rsvpEl) {
                            rsvpEl.scrollIntoView({ behavior: "smooth" });
                          }
                          setRsvpChoice("not_coming");
                        } else {
                          setShowConfirmGoingModal(true);
                          setRsvpChoice("coming");
                        }
                      }}
                    >
                      Change
                    </button>
                  )}
                </div>
              </div>

              {/* Item 2: $50 Deposit */}
              {isComing && (
                <div
                  data-testid="hub-deposit-row"
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    background: "#ffffff",
                    padding: "0.6rem 0.85rem",
                    borderRadius: "8px",
                    border: `1.5px solid ${depositStatus === "exempt" || depositStatus === "confirmed" || depositStatus === "confirmed_by_admin" ? "#86efac" : depositStatus === "submitted_by_member" ? "#93c5fd" : "#f59e0b"}`,
                    gap: "0.75rem",
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    {isCabinPayer || depositStatus === "exempt" ? (
                      <>
                        <span style={{ color: "#16a34a", fontWeight: 700, marginRight: "0.35rem" }}>✓</span>
                        <strong>$50 Cabin Deposit</strong>:{" "}
                        <span style={{ color: "#16a34a", fontWeight: 600 }}>Exempt (Cabin Payer)</span>
                      </>
                    ) : depositStatus === "confirmed" || depositStatus === "confirmed_by_admin" ? (
                      <>
                        <span style={{ color: "#16a34a", fontWeight: 700, marginRight: "0.35rem" }}>✓</span>
                        <strong>$50 Cabin Deposit</strong>:{" "}
                        <span style={{ color: "#16a34a", fontWeight: 600 }}>Confirmed</span>
                      </>
                    ) : depositStatus === "submitted_by_member" ? (
                      <>
                        <span style={{ color: "#2563eb", fontWeight: 700, marginRight: "0.35rem" }}>⏳</span>
                        <strong>$50 Cabin Deposit</strong>:{" "}
                        <span style={{ color: "#2563eb", fontWeight: 600 }}>Submitted (Pending Verification)</span>
                      </>
                    ) : (
                      <>
                        <span style={{ color: "#d97706", fontWeight: 700, marginRight: "0.35rem" }}>⚠️</span>
                        <strong>$50 Cabin Deposit</strong>:{" "}
                        <span style={{ color: "#b45309", fontWeight: 600 }}>Pending</span>
                      </>
                    )}
                  </div>
                  <div>
                    {isCabinPayer || depositStatus === "exempt" ? (
                      <span style={{ fontSize: "0.8rem", color: "#16a34a", fontWeight: 600, background: "#dcfce7", padding: "0.25rem 0.6rem", borderRadius: "9999px" }}>
                        Payer Exempt
                      </span>
                    ) : depositStatus === "confirmed" || depositStatus === "confirmed_by_admin" ? (
                      <span style={{ fontSize: "0.8rem", color: "#16a34a", fontWeight: 600, background: "#dcfce7", padding: "0.25rem 0.6rem", borderRadius: "9999px" }}>
                        Confirmed ✓
                      </span>
                    ) : depositStatus === "submitted_by_member" ? (
                      <span style={{ fontSize: "0.8rem", color: "#1d4ed8", fontWeight: 600, background: "#eff6ff", padding: "0.25rem 0.6rem", borderRadius: "9999px" }}>
                        Submitted ⏳
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={depositBusy}
                        onClick={() => void handleSubmitDeposit()}
                        style={{
                          padding: "0.35rem 0.75rem",
                          fontSize: "0.825rem",
                          borderRadius: "6px",
                          background: "#d97706",
                          color: "#ffffff",
                          border: "none",
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        {depositBusy ? "Submitting…" : "I Have Sent $50"}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Item 3: Daily Chores */}
              {isComing && (
                <div
                  data-testid="hub-chores-row"
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    background: "#ffffff",
                    padding: "0.6rem 0.85rem",
                    borderRadius: "8px",
                    border: `1px solid ${isChoresDone ? "#86efac" : "#fde68a"}`,
                    gap: "0.75rem",
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <span style={{ color: isChoresDone ? "#16a34a" : "#d97706", fontWeight: 700, marginRight: "0.35rem" }}>
                      {isChoresDone ? "✓" : "⚠️"}
                    </span>
                    <strong>Daily Chores Workload</strong>:{" "}
                    {isChoresDone ? (
                      <span style={{ color: "#16a34a", fontWeight: 600 }}>
                        {details.myDailyWorkload?.target != null ? `${details.myDailyWorkload.target}x target met` : "Target met"}
                      </span>
                    ) : (
                      <span style={{ color: "#b45309", fontWeight: 600 }}>
                        Action Needed {details.myDailyWorkload?.target != null ? `(Select ${details.myDailyWorkload.target}x chores for each day)` : "(Select your required duties)"}
                      </span>
                    )}
                  </div>
                  <div>
                    {isChoresDone ? (
                      <span style={{ fontSize: "0.8rem", color: "#16a34a", fontWeight: 600, background: "#dcfce7", padding: "0.25rem 0.6rem", borderRadius: "9999px" }}>
                        Complete
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="secondary-button"
                        style={{ fontSize: "0.8rem", padding: "0.25rem 0.6rem" }}
                        onClick={() => setTab("tasks")}
                      >
                        Choose Chores &rarr;
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Item 4: Meals & Drinks */}
              {isComing && (
                <div
                  data-testid="hub-meals-row"
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    background: "#ffffff",
                    padding: "0.6rem 0.85rem",
                    borderRadius: "8px",
                    border: "1px solid #86efac",
                    gap: "0.75rem",
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <span style={{ color: "#16a34a", fontWeight: 700, marginRight: "0.35rem" }}>
                      ✓
                    </span>
                    <strong>{hasAlcohol ? "☕🍷🍽️" : "☕🍽️"} Meals &amp; Drinks</strong>:{" "}
                    <span style={{ color: "#166534", fontWeight: 600 }}>
                      {mealSummaryText}
                    </span>
                  </div>
                  <div>
                    <button
                      type="button"
                      className="secondary-button"
                      style={{ fontSize: "0.8rem", padding: "0.25rem 0.6rem" }}
                      onClick={() => setShowMealModal(true)}
                    >
                      Edit Choices
                    </button>
                  </div>
                </div>
              )}

              {/* Item 5: Signature Activity */}
              {isComing && hasActivities && primaryActivity && (
                <div
                  data-testid="hub-activity-row"
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    background: "#ffffff",
                    padding: "0.6rem 0.85rem",
                    borderRadius: "8px",
                    border: `1px solid ${isActivityDone && !isEditingActivityChoice ? "#86efac" : "#fde68a"}`,
                    gap: "0.75rem",
                    flexWrap: "wrap",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setTab("activities")}
                    className="hub-activity-row-btn"
                  >
                    <span
                      style={{
                        color: isActivityDone && !isEditingActivityChoice ? "#16a34a" : "#d97706",
                        fontWeight: 700,
                        marginRight: "0.35rem",
                      }}
                    >
                      {isActivityDone && !isEditingActivityChoice ? "✓" : "⚠️"}
                    </span>
                    <strong>Signature Activity</strong>:{" "}
                    {myActivityParticipant?.status === "attending" && !isEditingActivityChoice ? (
                      <span style={{ color: "#16a34a", fontWeight: 600 }}>
                        Participating in {primaryActivity.title}
                      </span>
                    ) : myActivityParticipant?.status === "opted_out" && !isEditingActivityChoice ? (
                      <span style={{ color: "#16a34a", fontWeight: 600 }}>
                        Opted Out (Stay at Camp)
                      </span>
                    ) : (
                      <span style={{ color: "#b45309", fontWeight: 600 }}>
                        Action Needed
                      </span>
                    )}
                  </button>
                  <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                    {isActivityDone && !isEditingActivityChoice ? (
                      <>
                        <span
                          style={{
                            fontSize: "0.8rem",
                            color: "#16a34a",
                            fontWeight: 600,
                            background: "#dcfce7",
                            padding: "0.25rem 0.6rem",
                            borderRadius: "9999px",
                          }}
                        >
                          {myActivityParticipant?.status === "attending" ? "Attending ✓" : "Opted Out ✓"}
                        </span>
                        {canChangeActivity && (
                          <button
                            type="button"
                            className="secondary-button"
                            style={{ fontSize: "0.8rem", padding: "0.25rem 0.6rem" }}
                            onClick={() => setIsEditingActivityChoice(true)}
                          >
                            Change
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled={activityBusy}
                          onClick={() => void handleActivityParticipation("attending")}
                          style={{
                            padding: "0.35rem 0.75rem",
                            fontSize: "0.825rem",
                            borderRadius: "6px",
                            background: "#16a34a",
                            color: "#ffffff",
                            border: "none",
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          {activityBusy ? "Saving…" : "✓ Count Me In! 🚗"}
                        </button>
                        <button
                          type="button"
                          disabled={activityBusy}
                          onClick={() => void handleActivityParticipation("opted_out")}
                          style={{
                            padding: "0.35rem 0.75rem",
                            fontSize: "0.825rem",
                            borderRadius: "6px",
                            background: "#f1f5f9",
                            color: "#475569",
                            border: "1px solid #cbd5e1",
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          {activityBusy ? "Saving…" : "Opt Out 🏕️"}
                        </button>
                        {isEditingActivityChoice && (
                          <button
                            type="button"
                            className="secondary-button"
                            style={{ fontSize: "0.8rem", padding: "0.25rem 0.6rem" }}
                            onClick={() => setIsEditingActivityChoice(false)}
                          >
                            Cancel
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
            )}
            {activityMsg && (
              <p style={{ margin: "0.5rem 0 0", fontSize: "0.825rem", color: "#b91c1c" }} role="alert">
                {activityMsg}
              </p>
            )}
            {depositMsg && (
              <p style={{ margin: "0.5rem 0 0", fontSize: "0.825rem", color: "#15803d" }} role="status">
                {depositMsg}
              </p>
            )}
          </div>

          {/* Compact Activity Card */}
          {hasActivities && primaryActivity && (() => {
            const overviewCatKey = (primaryActivity.category || "other").toLowerCase();
            const overviewCatIcon =
              overviewCatKey === "tour"
                ? "🎯"
                : ACTIVITY_CATEGORIES[overviewCatKey]?.icon || "🎯";
            const overviewCategoryLabel = primaryActivity.category
              ? primaryActivity.category.charAt(0).toUpperCase() + primaryActivity.category.slice(1)
              : "Tour";
            const overviewUnitInfo =
              primaryActivity.unit_capacity && primaryActivity.unit_label
                ? ` (${primaryActivity.unit_capacity} per ${primaryActivity.unit_label})`
                : primaryActivity.unit_capacity
                ? ` (${primaryActivity.unit_capacity} per vehicle)`
                : "";
            const overviewCategoryBadge = `${overviewCatIcon} ${overviewCategoryLabel}${overviewUnitInfo}`;
            const overviewScheduleText = formatCompactActivitySchedule(
              primaryActivity.activity_date,
              primaryActivity.start_time,
              primaryActivity.end_time
            );
            const overviewLocationText =
              primaryActivity.location_name && primaryActivity.address
                ? primaryActivity.location_name === primaryActivity.address
                  ? primaryActivity.address
                  : `${primaryActivity.location_name} • ${primaryActivity.address}`
                : primaryActivity.address || primaryActivity.location_name || null;

            return (
              <div
                className="card"
                data-testid="hub-activity-overview-card"
                style={{
                  display: "flex",
                  gap: "1rem",
                  alignItems: "center",
                  padding: "1rem 1.25rem",
                  borderRadius: "10px",
                  border: "1px solid #e2e8f0",
                  background: "#ffffff",
                  boxShadow: "0 1px 3px rgba(0, 0, 0, 0.05)",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ flexShrink: 0 }}>
                  {primaryActivity.image_url && !activityImageError ? (
                    <img
                      src={primaryActivity.image_url}
                      alt={primaryActivity.title}
                      onError={() => setActivityImageError(true)}
                      style={{
                        width: "100px",
                        height: "85px",
                        borderRadius: "8px",
                        objectFit: "cover",
                        display: "block",
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: "100px",
                        height: "85px",
                        borderRadius: "8px",
                        background: "#f1f5f9",
                        border: "1px solid #e2e8f0",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "2rem",
                      }}
                      aria-label="Activity category icon"
                    >
                      {overviewCatIcon}
                    </div>
                  )}
                </div>

                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.35rem",
                    flex: 1,
                    minWidth: "220px",
                  }}
                >
                  {/* Line 1: Activity title + category badge */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                      flexWrap: "wrap",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setTab("activities")}
                      style={{
                        background: "none",
                        border: "none",
                        padding: 0,
                        font: "inherit",
                        fontSize: "1.05rem",
                        fontWeight: 700,
                        color: "#0f172a",
                        cursor: "pointer",
                        textAlign: "left",
                        textDecoration: "underline",
                        textUnderlineOffset: "3px",
                      }}
                    >
                      {primaryActivity.title}
                    </button>
                    <span
                      style={{
                        fontSize: "0.75rem",
                        fontWeight: 600,
                        background: "#f1f5f9",
                        color: "#475569",
                        padding: "2px 8px",
                        borderRadius: "9999px",
                        border: "1px solid #e2e8f0",
                      }}
                    >
                      {overviewCategoryBadge}
                    </span>
                  </div>

                  {/* Line 2: Schedule */}
                  {overviewScheduleText && (
                    <div style={{ color: "#334155", fontSize: "0.85rem", fontWeight: 500 }}>
                      📅 {overviewScheduleText}
                    </div>
                  )}

                  {/* Line 3: Location */}
                  {overviewLocationText && (
                    <div style={{ color: "#475569", fontSize: "0.85rem" }}>
                      📍 {overviewLocationText}
                    </div>
                  )}

                  {/* Line 4: Action buttons */}
                  <div
                    style={{
                      display: "flex",
                      gap: "0.5rem",
                      flexWrap: "wrap",
                      marginTop: "0.35rem",
                    }}
                  >
                    <button
                      type="button"
                      className="btn-sm-primary"
                      onClick={() => setTab("activities")}
                    >
                      View Activity &amp; Pairings &rarr;
                    </button>
                    {primaryActivity.booking_url && (
                      <a
                        href={primaryActivity.booking_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-sm-accent"
                      >
                        🎟️ Buy on Groupon / Booking Link &rarr;
                      </a>
                    )}
                    {primaryActivity.directions_url && (
                      <a
                        href={primaryActivity.directions_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-sm-secondary"
                      >
                        🧭 Directions
                      </a>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Section 2: 📋 TRIP TO-DO & CONTRIBUTIONS (VOLUNTARY) */}
          <div
            className="card"
            style={{
              background: "#f0fdf4",
              border: "1px solid #86efac",
              padding: "1rem 1.25rem",
              borderRadius: "10px",
            }}
          >
            <div style={{ marginBottom: "0.85rem" }}>
              <h2
                style={{
                  margin: 0,
                  fontWeight: 700,
                  color: "#166534",
                  fontSize: "1.05rem",
                  letterSpacing: "0.3px",
                }}
              >
                📋 Trip To-Do &amp; Contributions (Voluntary)
              </h2>
              <p style={{ margin: "0.25rem 0 0", fontSize: "0.85rem", color: "#4b5563" }}>
                Help with camp gear, groceries, packing, and shared group costs.
              </p>
            </div>

            {!isComing && (
              <div
                data-testid="not-attending-todo-banner"
                style={{
                  marginBottom: "0.75rem",
                  padding: "0.5rem 0.75rem",
                  background: "#fffbeb",
                  borderRadius: "6px",
                  color: "#92400e",
                  fontSize: "0.85rem",
                  border: "1px solid #fde68a",
                }}
              >
                ℹ️ Only confirmed Going attendees can volunteer for shared gear and groceries.
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
              {/* Shared Gear */}
              <div
                data-testid="todo-shared-gear"
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  background: "#ffffff",
                  padding: "0.6rem 0.85rem",
                  borderRadius: "8px",
                  border: "1px solid #bbf7d0",
                  gap: "0.75rem",
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <span style={{ marginRight: "0.4rem" }}>⛺</span>
                  <strong>Shared Gear</strong>:{" "}
                  {myClaimedGear.length > 0 ? (
                    <span>
                      You signed up for{" "}
                      <em>
                        {myClaimedGear.map((g) => g.itemName).join(", ")}
                      </em>
                    </span>
                  ) : (
                    <span style={{ color: "#64748b" }}>Help bring shared camping equipment</span>
                  )}
                </div>
                <button
                  type="button"
                  disabled={!isComing}
                  title={!isComing ? "Only confirmed Going attendees can volunteer for shared items" : undefined}
                  onClick={() => setTab("logistics")}
                  style={{
                    padding: "0.3rem 0.7rem",
                    fontSize: "0.8rem",
                    borderRadius: "4px",
                    border: "1px solid #10b981",
                    background: "#ffffff",
                    color: !isComing ? "#64748b" : "#047857",
                    fontWeight: 600,
                    cursor: !isComing ? "not-allowed" : "pointer",
                    opacity: !isComing ? 0.6 : 1,
                  }}
                >
                  {myClaimedGear.length > 0 ? "+ Claim More" : "+ Claim Shared Gear"}
                </button>
              </div>

              {/* Food & Groceries */}
              <div
                data-testid="todo-food-groceries"
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  background: "#ffffff",
                  padding: "0.6rem 0.85rem",
                  borderRadius: "8px",
                  border: "1px solid #bbf7d0",
                  gap: "0.75rem",
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <span style={{ marginRight: "0.4rem" }}>🍎</span>
                  <strong>Food &amp; Groceries</strong>:{" "}
                  {openFoodItems.length > 0 ? (
                    <span>
                      {openFoodItems.length} open {openFoodItems.length === 1 ? "item" : "items"} needed
                    </span>
                  ) : (
                    <span style={{ color: "#64748b" }}>All grocery staples claimed</span>
                  )}
                </div>
                <button
                  type="button"
                  disabled={!isComing}
                  title={!isComing ? "Only confirmed Going attendees can volunteer for shared items" : undefined}
                  onClick={() => setTab("logistics")}
                  style={{
                    padding: "0.3rem 0.7rem",
                    fontSize: "0.8rem",
                    borderRadius: "4px",
                    border: "1px solid #10b981",
                    background: "#ffffff",
                    color: !isComing ? "#64748b" : "#047857",
                    fontWeight: 600,
                    cursor: !isComing ? "not-allowed" : "pointer",
                    opacity: !isComing ? 0.6 : 1,
                  }}
                >
                  Volunteer Item
                </button>
              </div>

              {/* Personal Packing Checklist */}
              <div
                data-testid="todo-personal-packing"
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  background: "#ffffff",
                  padding: "0.6rem 0.85rem",
                  borderRadius: "8px",
                  border: "1px solid #bbf7d0",
                  gap: "0.75rem",
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <span style={{ marginRight: "0.4rem" }}>🎒</span>
                  <strong>Your Packing Checklist</strong>:{" "}
                  <span>
                    {individualPackItems.length} {individualPackItems.length === 1 ? "item" : "items"} to bring
                    {individualPackItems.length > 0 && (
                      <span
                        style={{
                          marginLeft: "0.4rem",
                          color: packedCount === individualPackItems.length ? "#16a34a" : "#2563eb",
                          fontWeight: 600,
                        }}
                      >
                        ({packedCount} of {individualPackItems.length} packed{packedCount === individualPackItems.length ? " ✓" : ""})
                      </span>
                    )}
                  </span>
                </div>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  {isAdmin && (
                    <button
                      type="button"
                      className="secondary-button"
                      style={{ fontSize: "0.8rem", padding: "0.3rem 0.6rem" }}
                      onClick={() => void handleSyncTripCommitments()}
                      title="Sync items from Master Catalog"
                    >
                      Sync Catalog 🔄
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowPackingModal(true)}
                    style={{
                      padding: "0.3rem 0.7rem",
                      fontSize: "0.8rem",
                      borderRadius: "4px",
                      border: "1px solid #cbd5e1",
                      background: "#f8fafc",
                      color: "#334155",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    View List 👁️
                  </button>
                </div>
              </div>

              {/* Shared Expenses */}
              <div
                data-testid="todo-shared-expense"
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  background: "#ffffff",
                  padding: "0.6rem 0.85rem",
                  borderRadius: "8px",
                  border: "1px solid #bbf7d0",
                  gap: "0.75rem",
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <span style={{ marginRight: "0.4rem" }}>🧾</span>
                  <strong>Shared Expenses</strong>: Bought supplies for the group? Post here
                </div>
                <button
                  type="button"
                  onClick={() => setTab("financials")}
                  style={{
                    padding: "0.3rem 0.7rem",
                    fontSize: "0.8rem",
                    borderRadius: "4px",
                    background: "#1c2d24",
                    color: "#ffffff",
                    border: "none",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  + Post Expense
                </button>
              </div>
            </div>
          </div>
          {details.campsite && (
            <div className="card">
              <h2>Campsite Information</h2>
              {details.campsite.imageUrl && (
                <div style={{ marginBottom: "1rem" }}>
                  <img
                    src={details.campsite.imageUrl}
                    alt={details.campsite.name}
                    style={{ width: "150px", height: "150px", aspectRatio: "1 / 1", objectFit: "cover", borderRadius: "12px", border: "1px solid #e5e7eb" }}
                  />
                </div>
              )}
              <p>
                <strong>{details.campsite.name}</strong>
              </p>
              {details.campsite.locationDescription && (
                <p>
                  <strong>Campsite Address:</strong> {details.campsite.locationDescription}
                </p>
              )}
              {details.campsite.campHostName && (
                <p>
                  <strong>Camp Host:</strong> {details.campsite.campHostName}
                  {details.campsite.campHostPhone ? ` (${details.campsite.campHostPhone})` : ""}
                </p>
              )}
              {details.campsite.cabinInformation && (
                <p>
                  <strong>Cabin Information:</strong> {details.campsite.cabinInformation}
                </p>
              )}
              {details.campsite.campFeatures && details.campsite.campFeatures.length > 0 && (
                <div style={{ margin: "0.5rem 0" }}>
                  <strong>Camp Features:</strong>
                  <div className="attendees-chips-grid">
                    {details.campsite.campFeatures.map((f, i) => (
                      <span key={i} className="attendee-chip">{f}</span>
                    ))}
                  </div>
                </div>
              )}
              {details.campsite.availabilityUrl && (
                <p>
                  <a href={details.campsite.availabilityUrl} target="_blank" rel="noopener noreferrer" aria-label="View campsite">
                    View campsite &gt;
                  </a>
                </p>
              )}
            </div>
          )}

          <div id="rsvp-actions-card" className="card">
            <h2>RSVP & Attendance</h2>
            <div style={{ marginBottom: "1rem", background: "#f8fafc", padding: "0.85rem", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
              <strong style={{ display: "block", fontSize: "0.85rem", textTransform: "uppercase", color: "#334155", letterSpacing: "0.04em", marginBottom: "0.25rem" }}>
                Deposit Obligation
              </strong>
              <div style={{ fontSize: "0.9rem", color: "#475569" }}>
                • <strong>$50.00 deposit</strong> per attendee is due upon confirmation to the assigned cabin payer.
                <button
                  type="button"
                  onClick={() => setTab("financials")}
                  style={{ marginLeft: "0.5rem", background: "none", border: "none", color: "#2563eb", textDecoration: "underline", cursor: "pointer", padding: 0, font: "inherit", fontWeight: 600 }}
                >
                  View in Financials &rarr;
                </button>
              </div>
            </div>

            <p>
              Your status: <strong>{rsvpStatusLabel}</strong>
            </p>

            {isComing && (
              details.myDailyWorkload?.target != null ? (
                details.myDailyWorkload.satisfied ? (
                  <div style={{ margin: "0.75rem 0", background: "#f0fdf4", border: "1px solid #bbf7d0", padding: "0.75rem 0.85rem", borderRadius: "8px", fontSize: "0.88rem", color: "#166534" }}>
                    ✓ <strong>Daily Chores Selected:</strong> You have selected your required chores for each event day.{" "}
                    <button type="button" onClick={() => setTab("tasks")} style={{ background: "none", border: "none", color: "#15803d", textDecoration: "underline", cursor: "pointer", padding: 0, font: "inherit", fontWeight: 600 }}>
                      View or change your chores in Tasks &amp; Meals &rarr;
                    </button>
                  </div>
                ) : (
                  <div style={{ margin: "0.75rem 0", background: "#fef3c7", border: "1px solid #fde68a", padding: "0.75rem 0.85rem", borderRadius: "8px", fontSize: "0.88rem", color: "#92400e" }}>
                    ⚠️ <strong>Action Needed:</strong> Please select chores worth {details.myDailyWorkload.target}x for each day.{" "}
                    <button type="button" onClick={() => setTab("tasks")} style={{ background: "none", border: "none", color: "#b45309", textDecoration: "underline", cursor: "pointer", padding: 0, font: "inherit", fontWeight: 700 }}>
                      Choose your daily chores now &rarr;
                    </button>
                  </div>
                )
              ) : (details.myDutyCount ?? 0) >= (details.taskQuotaTarget ?? 2) ? (
                <div style={{ margin: "0.75rem 0", background: "#f0fdf4", border: "1px solid #bbf7d0", padding: "0.75rem 0.85rem", borderRadius: "8px", fontSize: "0.88rem", color: "#166534" }}>
                  ✓ <strong>Duties Quota Complete:</strong> You have selected {details.myDutyCount} of {details.taskQuotaTarget ?? 2} camping duties.{" "}
                  <button type="button" onClick={() => setTab("tasks")} style={{ background: "none", border: "none", color: "#15803d", textDecoration: "underline", cursor: "pointer", padding: 0, font: "inherit", fontWeight: 600 }}>
                    View or change your duties in Tasks &amp; Meals &rarr;
                  </button>
                </div>
              ) : (
                <div style={{ margin: "0.75rem 0", background: "#fef3c7", border: "1px solid #fde68a", padding: "0.75rem 0.85rem", borderRadius: "8px", fontSize: "0.88rem", color: "#92400e" }}>
                  ⚠️ <strong>Action Needed:</strong> You have selected {details.myDutyCount ?? 0} of {details.taskQuotaTarget ?? 2} camping duties. Every attendee helps keep the trip smooth!{" "}
                  <button type="button" onClick={() => setTab("tasks")} style={{ background: "none", border: "none", color: "#b45309", textDecoration: "underline", cursor: "pointer", padding: 0, font: "inherit", fontWeight: 700 }}>
                    Choose your duties now &rarr;
                  </button>
                </div>
              )
            )}

            {canChangeRsvp && (
              <div className="response-actions">
                <button
                  type="button"
                  className={
                    rsvpChoice === "coming" || (!rsvpChoice && details.myRsvp?.response === "coming")
                      ? "selected"
                      : "secondary-button"
                  }
                  onClick={() => {
                    if (details.myRsvp?.response !== "coming") {
                      setShowConfirmGoingModal(true);
                      setRsvpChoice("coming");
                    } else {
                      setRsvpChoice(null);
                    }
                    setRsvpError(null);
                  }}
                >
                  {!rsvpChoice && details.myRsvp?.response === "coming" ? "Going ✓" : "Going"}
                </button>
                <button
                  type="button"
                  className={rsvpChoice === "not_coming" ? "selected" : "secondary-button"}
                  onClick={() => {
                    setRsvpChoice("not_coming");
                    setAcknowledged(false);
                    setRsvpError(null);
                  }}
                >
                  Not Going
                </button>
              </div>
            )}

            {showConfirmGoingModal && details && (
              <ConfirmGoingModal
                isOpen={showConfirmGoingModal}
                onClose={() => {
                  setShowConfirmGoingModal(false);
                  setRsvpChoice(null);
                }}
                tripTitle={details.title || `${monthName(details.monthKey)} Camping`}
                bundleVersion={details.currentRuleBundle?.version}
                rules={details.currentRuleBundle?.rules}
                rulesMarkdown={details.rulesMarkdown}
                busy={rsvpBusy}
                onConfirm={() => submitRsvpWithChoice("coming")}
              />
            )}

            {showLateWithdrawalWarning && (
              <p role="alert">
                You are withdrawing within 30 days of the trip. Your $50 deposit is non-refundable,
                and your withdrawal may increase costs for the people going. You can refer a replacement
                to the administrator and arrange to collect the deposit from that person once their spot is confirmed.
              </p>
            )}
            {rsvpChoice === "not_coming" && (
              <button type="button" onClick={() => void submitRsvp()} disabled={rsvpBusy}>
                {rsvpBusy ? "Saving…" : "Confirm Not Going"}
              </button>
            )}

            {waitlistedPosition !== null && (
              <p role="status">
                You are #{waitlistedPosition} on the waitlist. The administrator will notify you if a spot opens.
              </p>
            )}

            {rsvpError && (
              <p role="alert" className="form-error">
                {rsvpError}
              </p>
            )}

            {details.participantEntries.length > 0 && (
              <div style={{ marginTop: "1.25rem" }}>
                <h3>Who's going ({details.comingCount})</h3>
                {depositMsg && (
                  <p style={{ margin: "0.25rem 0 0.5rem", fontSize: "0.825rem", color: "#15803d", fontWeight: 600 }} role="status">
                    {depositMsg}
                  </p>
                )}
                <div className="attendees-chips-grid">
                  {details.participantEntries.map((e) => (
                    <div
                      key={e.memberId}
                      className="attendee-chip"
                      style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}
                    >
                      <span>{e.displayName}</span>
                      {e.depositStatus === "exempt" ? (
                        <span style={{ fontSize: "0.72rem", color: "#15803d", fontWeight: 600 }}>
                          (Payer Exempt)
                        </span>
                      ) : e.depositStatus === "confirmed" || e.depositStatus === "confirmed_by_admin" ? (
                        <span style={{ fontSize: "0.72rem", color: "#15803d", fontWeight: 600 }}>
                          ($50 Paid ✓)
                        </span>
                      ) : e.depositStatus === "submitted_by_member" ? (
                        <span style={{ fontSize: "0.72rem", color: "#2563eb", fontWeight: 600 }}>
                          ($50 Submitted ⏳)
                        </span>
                      ) : (
                        <span style={{ fontSize: "0.72rem", color: "#b45309", fontWeight: 600 }}>
                          (Deposit Pending)
                        </span>
                      )}
                      {canVerifyDeposit && (
                        <div style={{ display: "inline-flex", alignItems: "center", gap: "0.2rem" }}>
                          {(e.depositStatus === "confirmed" || e.depositStatus === "confirmed_by_admin") && (
                            <>
                              <button
                                type="button"
                                disabled={depositBusy}
                                onClick={() => void handleVerifyDeposit(e.memberId, "unpaid")}
                                className="btn-unverify-deposit"
                                style={{
                                  fontSize: "0.72rem",
                                  padding: "0.15rem 0.45rem",
                                  borderRadius: "4px",
                                  background: "#fef2f2",
                                  color: "#dc2626",
                                  border: "1px solid #fca5a5",
                                  cursor: "pointer",
                                  fontWeight: 600,
                                }}
                                title="Reset deposit status to pending"
                              >
                                Unverify
                              </button>
                              <button
                                type="button"
                                disabled={depositBusy}
                                onClick={() => void handleVerifyDeposit(e.memberId, "exempt")}
                                className="btn-exempt-deposit"
                                style={{
                                  fontSize: "0.72rem",
                                  padding: "0.15rem 0.45rem",
                                  borderRadius: "4px",
                                  background: "#f0fdf4",
                                  color: "#15803d",
                                  border: "1px solid #86efac",
                                  cursor: "pointer",
                                  fontWeight: 600,
                                }}
                                title="Mark as Cabin Payer (Exempt from $50 deposit)"
                              >
                                Set Cabin Payer
                              </button>
                            </>
                          )}

                          {e.depositStatus === "exempt" && (
                            <button
                              type="button"
                              disabled={depositBusy}
                              onClick={() => void handleVerifyDeposit(e.memberId, "unpaid")}
                              className="btn-unverify-deposit"
                              style={{
                                fontSize: "0.72rem",
                                padding: "0.15rem 0.45rem",
                                borderRadius: "4px",
                                background: "#fef2f2",
                                color: "#dc2626",
                                border: "1px solid #fca5a5",
                                cursor: "pointer",
                                fontWeight: 600,
                              }}
                              title="Remove Cabin Payer exemption"
                            >
                              Unset Payer
                            </button>
                          )}

                          {e.depositStatus !== "exempt" && e.depositStatus !== "confirmed" && e.depositStatus !== "confirmed_by_admin" && (
                            <>
                              <button
                                type="button"
                                disabled={depositBusy}
                                onClick={() => void handleVerifyDeposit(e.memberId, "confirmed_by_admin")}
                                className="btn-verify-deposit"
                                style={{
                                  fontSize: "0.72rem",
                                  padding: "0.15rem 0.45rem",
                                  borderRadius: "4px",
                                  background: "#16a34a",
                                  color: "#ffffff",
                                  border: "none",
                                  cursor: "pointer",
                                  fontWeight: 600,
                                }}
                                title="Verify $50 deposit payment"
                              >
                                Verify Deposit
                              </button>
                              <button
                                type="button"
                                disabled={depositBusy}
                                onClick={() => void handleVerifyDeposit(e.memberId, "exempt")}
                                className="btn-exempt-deposit"
                                style={{
                                  fontSize: "0.72rem",
                                  padding: "0.15rem 0.45rem",
                                  borderRadius: "4px",
                                  background: "#f0fdf4",
                                  color: "#15803d",
                                  border: "1px solid #86efac",
                                  cursor: "pointer",
                                  fontWeight: 600,
                                }}
                                title="Mark as Cabin Payer (Exempt from $50 deposit)"
                              >
                                Set Cabin Payer
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {isAdmin && details.allMemberEntries && details.allMemberEntries.length > 0 && (
              <div className="admin-roster-box">
                <h3>Admin: Manage Attendee Roster</h3>
                <p style={{ margin: 0, fontSize: "0.85rem", color: "#6b7280" }}>
                  Select or deselect members to update who is going.
                </p>
                {adminRosterMsg && <p role="status">{adminRosterMsg}</p>}
                <div style={{ display: "grid", gap: "0.5rem" }}>
                  {details.allMemberEntries.map((m) => {
                    const isMemberGoing = m.response === "coming";
                    return (
                      <label key={m.memberId} className="admin-roster-item">
                        <input
                          type="checkbox"
                          checked={isMemberGoing}
                          disabled={rsvpBusy}
                          onChange={() => void toggleAdminRoster(m.memberId, m.response, m.version)}
                        />
                        <span>{m.displayName}</span>
                        {isMemberGoing && <span className="status-badge-going" style={{ fontSize: "0.7rem" }}>Going</span>}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {isAdmin && details.waitlistEntries.length > 0 && (
              <details style={{ marginTop: "1rem" }}>
                <summary>Waitlist ({details.waitlistEntries.length})</summary>
                <ol>
                  {details.waitlistEntries.map((w) => (
                    <li key={w.memberId}>
                      #{w.position} {w.displayName}
                      <button type="button" disabled={rsvpBusy} onClick={() => void promoteFromWaitlist(w.memberId)}>
                        Promote
                      </button>
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </div>

          {details.rulesMarkdown && (
            <div className="card">
              <h2 style={{ fontSize: "1.1rem" }}>📜 Camping Constitution &amp; Trip Notes</h2>
              <div
                style={{
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  borderRadius: "8px",
                  padding: "1rem",
                  fontSize: "0.875rem",
                  lineHeight: 1.6,
                  whiteSpace: "pre-wrap",
                  color: "#1e293b",
                }}
              >
                {details.rulesMarkdown}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "constitution" && (
        <div className="stack">
          {details.rulesMarkdown && (
            <div className="card" style={{ marginBottom: "1rem" }}>
              <h2>📜 Camping Constitution &amp; Trip Notes</h2>
              <div
                style={{
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  borderRadius: "8px",
                  padding: "1rem",
                  fontSize: "0.9rem",
                  lineHeight: 1.6,
                  whiteSpace: "pre-wrap",
                  color: "#1e293b",
                }}
              >
                {details.rulesMarkdown}
              </div>
            </div>
          )}
          <div className="card">
            <h2>Camping Constitution</h2>
            {!details.currentRuleBundle && <p>No constitution bundle available for this trip.</p>}
            {details.currentRuleBundle && (
              <>
                <p className="eyebrow">Version {details.currentRuleBundle.version}</p>
                {groupedRules.map(
                  (group) =>
                    group.rules.length > 0 && (
                      <details key={group.label} className="rule-history" open>
                        <summary>{group.label}</summary>
                        <div className="rules-list">
                          {group.rules.map((rule) => (
                            <article key={rule.stable_key}>
                              <h4>{rule.stable_key.replaceAll("-", " ")}</h4>
                              <p>{rule.text}</p>
                            </article>
                          ))}
                        </div>
                      </details>
                    )
                )}
                {details.myRsvp?.response === "coming" && details.myRsvp.acknowledgmentId && (
                  <p className="eyebrow">You acknowledged version {details.myRsvp.acceptedRuleBundle?.version ?? details.currentRuleBundle.version}.</p>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {tab === "logistics" && (
        <TripLogisticsTab
          tripId={details.tripId}
          isConfirmedAttendee={isComing}
          isAdmin={isAdmin}
          currentMemberId={authProfileMemberId}
          confirmedAttendees={confirmedAttendees}
          tripNotes={details.additionalInformation}
          reservationInstructions={details.campsite?.reservationInstructions}
          drivingDirections={details.campsite?.directions}
          api={api}
          onEditLogistics={() => setShowEditLogistics(true)}
        />
      )}

      {tab === "financials" && (
        <TripFinancialsTab
          tripId={details.tripId}
          isAdmin={isAdmin}
          isConfirmedAttendee={isComing}
          currentMemberId={authProfileMemberId}
          confirmedAttendees={confirmedAttendees}
          tripStatus={details.tripStatus ?? details.eventStatus}
          api={api}
          onStatusChange={refresh}
        />
      )}

      {tab === "tasks" && (
        <TripTasksAndMealsTab
          tripId={details.tripId}
          refreshVersion={details.version}
          isConfirmedAttendee={isComing}
          isAdmin={isAdmin}
          currentMemberId={authProfileMemberId}
          api={api}
          onDutyChanged={refresh}
        />
      )}

      {tab === "activities" && (
        <TripActivitiesTab
          tripId={details.tripId}
          isAdmin={isAdmin}
          isConfirmedAttendee={isComing}
          currentMemberId={authProfileMemberId}
          api={api}
          onRefresh={refresh}
        />
      )}

      {showDutyPromptModal && (
        <PostRsvpDutyModal
          tripTitle={tripTitle}
          quotaTarget={details.taskQuotaTarget ?? 2}
          dailyTarget={details.myDailyWorkload?.target}
          dailySatisfied={details.myDailyWorkload?.satisfied}
          onChooseDuties={() => {
            setShowDutyPromptModal(false);
            setTab("tasks");
          }}
          onClose={() => setShowDutyPromptModal(false)}
        />
      )}

      {showEditLogistics && details && (
        <EditLogisticsModal
          details={details}
          api={api}
          onClose={() => setShowEditLogistics(false)}
          onRefresh={refresh}
        />
      )}

      {showEditEventModal && details && (
        <EditTripDetailsModal
          details={details}
          api={api}
          onClose={() => setShowEditEventModal(false)}
          onRefresh={refresh}
        />
      )}

      {showTimeSlotsModal && details && (
        <AdminTimeSlotManagerModal
          tripId={details.tripId}
          tripStartsOn={details.startsOn}
          tripEndsOn={details.endsOn}
          api={api}
          onClose={() => setShowTimeSlotsModal(false)}
          onRefreshParent={refresh}
        />
      )}

      {showPackingModal && (
        <PersonalPackingListModal
          items={individualPackItems}
          packedItemIds={packedItemIds}
          onTogglePacked={handleTogglePacked}
          onClose={() => setShowPackingModal(false)}
          isAdmin={isAdmin}
          onSyncMaster={isAdmin ? handleSyncTripCommitments : undefined}
          onAddItem={isAdmin ? handleAddPackingItem : undefined}
          onDeleteItem={isAdmin ? handleDeletePackingItem : undefined}
        />
      )}

      {showMealModal && details && (
        <MealPreferencesModal
          isOpen={showMealModal}
          onClose={() => setShowMealModal(false)}
          tripId={details.tripId}
          mealSlots={mealSlots}
          initialPreferences={details.myMealPreferences}
          onSave={handleSaveMealPreferences}
        />
      )}
    </section>
  );
}

function EditTripDetailsModal({
  details,
  api,
  onClose,
  onRefresh,
}: {
  details: TripDetails;
  api: TripApiType;
  onClose: () => void;
  onRefresh: () => Promise<void>;
}) {
  const [title, setTitle] = useState(details.title || `${monthName(details.monthKey)} Camping`);
  const [startsOn, setStartsOn] = useState(details.startsOn ?? "");
  const [endsOn, setEndsOn] = useState(details.endsOn ?? "");
  const [deadline, setDeadline] = useState(details.pollDeadlineAt ? details.pollDeadlineAt.slice(0, 10) : "");
  const [deadlineTime, setDeadlineTime] = useState(details.pollDeadlineAt ? details.pollDeadlineAt.slice(11, 16) : "18:00");
  const [minimum, setMinimum] = useState(details.minimumParticipants ?? 4);
  const [capacity, setCapacity] = useState(details.maxCapacity?.toString() ?? "");
  const [cabinCount, setCabinCount] = useState(details.cabinCount?.toString() ?? "");
  const [perCabinCapacity, setPerCabinCapacity] = useState(details.perCabinCapacity?.toString() ?? "6");
  const [campingType, setCampingType] = useState<"cabin" | "tent" | "rv" | "boat">(details.campingType ?? "cabin");
  const [eventStatus, setEventStatus] = useState<string>(details.tripStatus || details.eventStatus || "rsvp_open");
  const [bookingStatus, setBookingStatus] = useState<string>(details.cabinBookingStatus || "not_booked");
  const [cabinPayerMemberId, setCabinPayerMemberId] = useState<string>(details.cabinPayerMemberId || details.cabinReservation?.paid_by_member_id || "");
  const [information, setInformation] = useState(details.additionalInformation ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function handleStartsOnChange(val: string) {
    setStartsOn(val);
    if (!endsOn || endsOn < val) {
      setEndsOn(val);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api("admin_configure_trip", {
        tripId: details.tripId,
        startsOn,
        endsOn,
        deadlineDate: deadline || null,
        deadlineTime: deadlineTime || null,
        minimumParticipants: Number(minimum),
        maxCapacity: capacity ? Number(capacity) : null,
        cabinCount: cabinCount ? Number(cabinCount) : null,
        perCabinCapacity: perCabinCapacity ? Number(perCabinCapacity) : 6,
        selectedCampsiteId: details.selectedCampsiteId || details.campsite?.campsiteId || "",
        cabinBookingStatus: bookingStatus,
        cabinPayerMemberId: cabinPayerMemberId || null,
        additionalInformation: information,
        title: title.trim() || null,
        eventStatus,
        campingType,
        expectedVersion: details.version,
        reason: "Administrator configured trip from event details page",
      });
      await onRefresh();
      onClose();
    } catch {
      setMsg("Could not save trip configuration. Please check all inputs.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h2>Edit {title || `${monthName(details.monthKey)} Camping`}</h2>
        <form className="admin-form" onSubmit={handleSave}>
          <label>
            Event Name
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={`${monthName(details.monthKey)} Camping`}
            />
          </label>
          <div className="form-grid">
            <label>
              Trip start
              <input type="date" required value={startsOn} onChange={(e) => handleStartsOnChange(e.target.value)} />
            </label>
            <label>
              Trip end
              <input type="date" required min={startsOn || undefined} value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
            </label>
            <label>
              Camping Type
              <select value={campingType} onChange={(e) => setCampingType(e.target.value as any)}>
                {campingTypes.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </label>
            <label>
              Event Status
              <select value={eventStatus} onChange={(e) => setEventStatus(e.target.value as any)}>
                {eventStatuses.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </label>
            <label>
              Camping Type Sites Count
              <input type="number" min="1" max="50" value={cabinCount} onChange={(e) => setCabinCount(e.target.value)} />
            </label>
            <label>
              Camping Type Site Capacity
              <input type="number" min="1" max="50" value={perCabinCapacity} onChange={(e) => setPerCabinCapacity(e.target.value)} />
            </label>
            <label>
              Registration deadline date
              <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </label>
            <label>
              Deadline time
              <input type="time" value={deadlineTime} onChange={(e) => setDeadlineTime(e.target.value)} />
            </label>
            <label>
              Minimum participants
              <input type="number" min="1" max="100" required value={minimum} onChange={(e) => setMinimum(Number(e.target.value))} />
            </label>
            <label>
              Max capacity (optional)
              <input type="number" min="1" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
            </label>
          </div>
          <label>
            Cabin Booking Status
            <select required value={bookingStatus} onChange={(e) => setBookingStatus(e.target.value as any)}>
              {cabinBookingStatuses.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </label>
          <label>
            Cabin Reservation Payer
            <select value={cabinPayerMemberId} onChange={(e) => setCabinPayerMemberId(e.target.value)}>
              <option value="">-- No Cabin Payer Assigned --</option>
              {details.participantEntries.map((p) => (
                <option key={p.memberId} value={p.memberId}>
                  {p.displayName} (Confirmed Attendee)
                </option>
              ))}
              {details.allMemberEntries
                ?.filter((m) => !details.participantEntries.some((p) => p.memberId === m.memberId))
                .map((m) => (
                  <option key={m.memberId} value={m.memberId}>
                    {m.displayName}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Trip notes &amp; information
            <textarea value={information} onChange={(e) => setInformation(e.target.value)} />
          </label>
          {msg && <p role="alert" className="form-error">{msg}</p>}
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
            <button type="submit" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
            <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditLogisticsModal({
  details,
  api,
  onClose,
  onRefresh,
}: {
  details: TripDetails;
  api: TripApiType;
  onClose: () => void;
  onRefresh: () => Promise<void>;
}) {
  const [information, setInformation] = useState(details.additionalInformation ?? "");
  const [directions, setDirections] = useState(details.campsite?.directions ?? "");
  const [instructions, setInstructions] = useState(details.campsite?.reservationInstructions ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api("admin_configure_trip", {
        tripId: details.tripId,
        startsOn: details.startsOn ?? "",
        endsOn: details.endsOn ?? "",
        deadlineDate: details.pollDeadlineAt ? details.pollDeadlineAt.slice(0, 10) : null,
        deadlineTime: details.pollDeadlineAt ? details.pollDeadlineAt.slice(11, 16) : null,
        minimumParticipants: details.minimumParticipants ?? 4,
        maxCapacity: details.maxCapacity ?? null,
        cabinCount: details.cabinCount ?? null,
        perCabinCapacity: details.perCabinCapacity ?? 6,
        selectedCampsiteId: details.selectedCampsiteId || details.campsite?.campsiteId || "",
        cabinBookingStatus: details.cabinBookingStatus ?? "booked",
        additionalInformation: information,
        expectedVersion: details.version,
        reason: "Administrator updated trip logistics & packing notes",
      });

      if (
        details.campsite &&
        (directions !== (details.campsite.directions ?? "") ||
          instructions !== (details.campsite.reservationInstructions ?? ""))
      ) {
        await api("admin_update_campsite", {
          campsiteId: details.campsite.campsiteId,
          expectedVersion: details.campsite.version ?? 1,
          name: details.campsite.name,
          locationDescription: details.campsite.locationDescription,
          directions: directions || null,
          reservationInstructions: instructions || null,
          cabinCapacity: details.campsite.cabinCapacity,
          cabinTypes: details.campsite.cabinTypes ?? ["cabin"],
          estimatedRateCents: details.campsite.estimatedRateCents ?? null,
          availabilityStatus: details.campsite.availabilityStatus ?? "unknown",
          availabilityUrl: details.campsite.availabilityUrl ?? null,
          availabilitySourceUrl: details.campsite.availabilitySourceUrl ?? null,
          availabilityVerifiedAt: null,
          imageUrl: details.campsite.imageUrl ?? null,
          campHostName: details.campsite.campHostName ?? null,
          campHostPhone: details.campsite.campHostPhone ?? null,
          campFeatures: details.campsite.campFeatures ?? [],
          cabinInformation: details.campsite.cabinInformation ?? null,
          adminNotes: details.campsite.adminNotes ?? "",
          reason: "Administrator updated directions and instructions from Logistics tab",
        });
      }

      await onRefresh();
      onClose();
    } catch {
      setMsg("Could not save logistics details. Please check all inputs.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h2>Edit Logistics &amp; Packing</h2>
        <form className="admin-form" onSubmit={handleSave}>
          <label>
            Trip Packing &amp; Logistics Notes
            <textarea
              rows={5}
              placeholder="Packing checklist, equipment items, meeting point, food planning notes..."
              value={information}
              onChange={(e) => setInformation(e.target.value)}
            />
          </label>
          {details.campsite && (
            <>
              <label>
                Driving Directions
                <textarea
                  rows={3}
                  placeholder="Directions, highway exits, parking instructions..."
                  value={directions}
                  onChange={(e) => setDirections(e.target.value)}
                />
              </label>
              <label>
                Campsite Reservation &amp; Check-In Instructions
                <textarea
                  rows={3}
                  placeholder="Check-in procedures, gate access code, cabin numbers..."
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                />
              </label>
            </>
          )}
          {msg && <p role="alert" className="form-error">{msg}</p>}
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
            <button type="submit" disabled={busy}>{busy ? "Saving…" : "Save Logistics & Packing"}</button>
            <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PersonalPackingListModal({
  items,
  packedItemIds,
  onTogglePacked,
  onClose,
  isAdmin,
  onSyncMaster,
  onAddItem,
  onDeleteItem,
}: {
  items: Array<{ id?: string; itemName: string; category?: string; quantityDescription?: string | null }>;
  packedItemIds: Set<string>;
  onTogglePacked: (idOrName: string) => void;
  onClose: () => void;
  isAdmin?: boolean;
  onSyncMaster?: () => Promise<void>;
  onAddItem?: (name: string, qty?: string, cat?: string) => Promise<void>;
  onDeleteItem?: (id: string) => Promise<void>;
}) {
  const [newItemName, setNewItemName] = useState("");
  const [newItemQty, setNewItemQty] = useState("");
  const [newItemCat, setNewItemCat] = useState("gear");
  const [busy, setBusy] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const packedCount = items.filter((i) => packedItemIds.has(i.id || i.itemName)).length;
  const progressPercent = items.length > 0 ? Math.round((packedCount / items.length) * 100) : 0;

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newItemName.trim() || !onAddItem) return;
    setBusy(true);
    try {
      await onAddItem(newItemName.trim(), newItemQty.trim() || undefined, newItemCat);
      setNewItemName("");
      setNewItemQty("");
      setShowAddForm(false);
    } catch (err) {
      console.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleSync() {
    if (!onSyncMaster) return;
    setSyncBusy(true);
    try {
      await onSyncMaster();
    } catch (err) {
      console.error(err);
    } finally {
      setSyncBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="packing-modal-title"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: "1rem",
      }}
    >
      <div
        className="card"
        style={{
          maxWidth: "560px",
          width: "100%",
          maxHeight: "85vh",
          overflowY: "auto",
          background: "#ffffff",
          borderRadius: "12px",
          padding: "1.5rem",
          display: "flex",
          flexDirection: "column",
          gap: "1rem",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h3 id="packing-modal-title" style={{ margin: 0, fontSize: "1.2rem", color: "#0f172a" }}>
              🎒 Personal Packing Checklist
            </h3>
            <p style={{ margin: "0.25rem 0 0", fontSize: "0.825rem", color: "#64748b" }}>
              Check off items as you pack them into your car or backpack.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: "1.25rem",
              cursor: "pointer",
              padding: "0.25rem 0.5rem",
              color: "#64748b",
            }}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>

        {/* Progress Bar */}
        {items.length > 0 && (
          <div style={{ background: "#f8fafc", padding: "0.75rem 1rem", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.4rem" }}>
              <span style={{ color: progressPercent === 100 ? "#16a34a" : "#1e293b" }}>
                {progressPercent === 100 ? "🎉 All Packed & Ready!" : `Packed ${packedCount} of ${items.length} items`}
              </span>
              <span style={{ color: "#64748b" }}>{progressPercent}%</span>
            </div>
            <div style={{ height: "8px", width: "100%", background: "#e2e8f0", borderRadius: "4px", overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: `${progressPercent}%`,
                  background: progressPercent === 100 ? "#22c55e" : "#3b82f6",
                  transition: "width 0.3s ease",
                }}
              />
            </div>
          </div>
        )}

        {/* Admin Quick Actions */}
        {isAdmin && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", padding: "0.5rem 0" }}>
            <span style={{ fontSize: "0.8rem", color: "#64748b", fontWeight: 600 }}>Organizer Controls:</span>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              {onSyncMaster && (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={syncBusy}
                  onClick={() => void handleSync()}
                  style={{ fontSize: "0.78rem", padding: "0.25rem 0.6rem" }}
                >
                  {syncBusy ? "Syncing…" : "🔄 Sync from Catalog"}
                </button>
              )}
              {onAddItem && (
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => setShowAddForm(!showAddForm)}
                  style={{ fontSize: "0.78rem", padding: "0.25rem 0.6rem" }}
                >
                  {showAddForm ? "Cancel Add" : "+ Add Packing Item"}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Add Item Form (Admin) */}
        {showAddForm && isAdmin && onAddItem && (
          <form
            onSubmit={(e) => void handleAdd(e)}
            style={{
              padding: "0.85rem",
              background: "#f0fdf4",
              borderRadius: "8px",
              border: "1px solid #86efac",
              display: "flex",
              flexDirection: "column",
              gap: "0.5rem",
            }}
          >
            <div style={{ fontWeight: 600, fontSize: "0.85rem", color: "#166534" }}>Add Personal Item for This Trip</div>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <input
                type="text"
                placeholder="Item name (e.g., Rain Jacket)"
                value={newItemName}
                onChange={(e) => setNewItemName(e.target.value)}
                required
                style={{ flex: "2 1 180px", padding: "0.4rem 0.6rem", fontSize: "0.85rem", borderRadius: "4px", border: "1px solid #cbd5e1" }}
              />
              <input
                type="text"
                placeholder="Qty (e.g., 1)"
                value={newItemQty}
                onChange={(e) => setNewItemQty(e.target.value)}
                style={{ flex: "1 1 80px", padding: "0.4rem 0.6rem", fontSize: "0.85rem", borderRadius: "4px", border: "1px solid #cbd5e1" }}
              />
              <select
                value={newItemCat}
                onChange={(e) => setNewItemCat(e.target.value)}
                style={{ flex: "1 1 100px", padding: "0.4rem 0.6rem", fontSize: "0.85rem", borderRadius: "4px", border: "1px solid #cbd5e1" }}
              >
                <option value="gear">Gear</option>
                <option value="sleep">Sleep</option>
                <option value="clothing">Clothing</option>
                <option value="shelter">Shelter</option>
                <option value="safety">Safety</option>
                <option value="tools">Tools</option>
                <option value="kitchen">Kitchen</option>
                <option value="other">Other</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={busy || !newItemName.trim()}
              className="primary-button"
              style={{ alignSelf: "flex-end", fontSize: "0.8rem", padding: "0.3rem 0.8rem" }}
            >
              {busy ? "Adding…" : "+ Add Item to Checklist"}
            </button>
          </form>
        )}

        {/* Items List */}
        {items.length === 0 ? (
          <div style={{ textAlign: "center", padding: "1.5rem 1rem", background: "#f8fafc", borderRadius: "8px", border: "1px dashed #cbd5e1" }}>
            <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>🎒</div>
            <p style={{ margin: "0 0 0.5rem 0", color: "#475569", fontWeight: 600 }}>
              No personal packing items listed for this trip yet.
            </p>
            <p style={{ margin: "0 0 1rem 0", fontSize: "0.825rem", color: "#64748b" }}>
              {isAdmin
                ? "As an organizer, sync items from the Master Catalog or add custom trip items above."
                : "The trip organizer hasn't published packing recommendations yet."}
            </p>
            {isAdmin && onSyncMaster && (
              <button
                type="button"
                className="primary-button"
                disabled={syncBusy}
                onClick={() => void handleSync()}
                style={{ fontSize: "0.85rem", padding: "0.4rem 0.9rem" }}
              >
                {syncBusy ? "Syncing…" : "🔄 Sync from Master Catalog"}
              </button>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", maxHeight: "40vh", overflowY: "auto" }}>
            {items.map((item, idx) => {
              const key = item.id || item.itemName || String(idx);
              const isPacked = packedItemIds.has(key) || (item.id && packedItemIds.has(item.id)) || packedItemIds.has(item.itemName);
              return (
                <div
                  key={key}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "0.55rem 0.85rem",
                    background: isPacked ? "#f0fdf4" : "#ffffff",
                    borderRadius: "6px",
                    border: `1px solid ${isPacked ? "#86efac" : "#e2e8f0"}`,
                    transition: "all 0.2s ease",
                  }}
                >
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.6rem",
                      cursor: "pointer",
                      flex: 1,
                      margin: 0,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(isPacked)}
                      onChange={() => onTogglePacked(item.id || item.itemName)}
                      style={{ width: "17px", height: "17px", cursor: "pointer", accentColor: "#16a34a" }}
                    />
                    <div>
                      <span
                        style={{
                          color: isPacked ? "#15803d" : "#1e293b",
                          fontSize: "0.875rem",
                          fontWeight: 500,
                          textDecoration: isPacked ? "line-through" : "none",
                        }}
                      >
                        {item.itemName}
                      </span>
                      {item.quantityDescription && (
                        <span style={{ fontSize: "0.78rem", color: "#64748b", marginLeft: "0.35rem" }}>
                          ({item.quantityDescription})
                        </span>
                      )}
                    </div>
                  </label>

                  <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                    <span
                      style={{
                        fontSize: "0.72rem",
                        padding: "0.15rem 0.45rem",
                        background: isPacked ? "#dcfce7" : "#f1f5f9",
                        color: isPacked ? "#166534" : "#475569",
                        borderRadius: "4px",
                        textTransform: "capitalize",
                      }}
                    >
                      {item.category ?? "gear"}
                    </span>
                    {isAdmin && item.id && onDeleteItem && (
                      <button
                        type="button"
                        onClick={() => void onDeleteItem(item.id!)}
                        title="Delete item from this trip"
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          color: "#94a3b8",
                          padding: "0.15rem 0.35rem",
                          fontSize: "0.85rem",
                          borderRadius: "4px",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = "#dc2626")}
                        onMouseLeave={(e) => (e.currentTarget.style.color = "#94a3b8")}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "0.5rem" }}>
          <span style={{ fontSize: "0.75rem", color: "#94a3b8" }}>
            💡 Checklist progress is saved locally on your device.
          </span>
          <button
            type="button"
            className="secondary-button"
            onClick={onClose}
            style={{ padding: "0.4rem 1rem", fontSize: "0.875rem" }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

