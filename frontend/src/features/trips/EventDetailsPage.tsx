import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useAuth } from "../../app/AuthProvider";
import { invokeTripApi, TripApiError } from "../../lib/supabase";
import { AdminTimeSlotManagerModal } from "./AdminTimeSlotManagerModal";
import { TripTasksAndMealsTab } from "./TripTasksAndMealsTab";
import { PostRsvpDutyModal } from "./PostRsvpDutyModal";
import { DailyWorkloadProgress, dailyWorkloadLabel, type DailyWorkload } from "./DailyWorkloadProgress";
import { formatCabinBookingStatus } from "./TripCalendarPage";

type TripDetails = {
  tripId: string;
  monthKey: string;
  title?: string | null;
  eventStatus?: "tentative" | "confirmed" | "cancelled";
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
  participantEntries: Array<{ memberId: string; displayName: string; response: string }>;
  waitlistEntries: Array<{ memberId: string; displayName: string; position: number; createdAt: string }>;
  allMemberEntries?: Array<{ memberId: string; displayName: string; response: string; version: number }>;
  version: number;
};

type Tab = "overview" | "constitution" | "logistics" | "tasks" | "financials";
export type TripApiType = <T = unknown>(action: string, input?: unknown) => Promise<T>;

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
  { value: "tentative", label: "Tentative" },
  { value: "confirmed", label: "Confirmed" },
  { value: "cancelled", label: "Cancelled" },
];

const cabinBookingStatuses = [
  { value: "booked", label: "Booked" },
  { value: "pending", label: "Pending (sites available)" },
];

function monthName(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1)));
}

type Props = { isAdmin: boolean; currentMemberId?: string; api?: TripApiType };
const defaultApi: TripApiType = (action, input) => invokeTripApi(action, input);

export function EventDetailsPage({ isAdmin, currentMemberId, api = defaultApi }: Props) {
  const { tripId } = useParams<{ tripId: string }>();
  const navigate = useNavigate();
  let authProfileMemberId = currentMemberId;
  try {
    const auth = useAuth();
    authProfileMemberId = auth?.profile?.memberId ?? currentMemberId;
  } catch {
    // AuthProvider not present (e.g. isolated component unit tests)
  }
  const [details, setDetails] = useState<TripDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = searchParams.get("tab") as Tab | null;
  const validTabs: Tab[] = ["overview", "constitution", "logistics", "tasks", "financials"];
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

  async function refresh() {
    if (!tripId) return;
    setError(null);
    try {
      const [tripResult, constitutionResult] = await Promise.all([
        api<TripDetails>("get_trip_details", { tripId }),
        api<{ definitions?: Array<{ stable_key: string; category: string }> }>("get_constitution", { tripId }).catch(() => null),
      ]);
      setDetails(tripResult);
      if (constitutionResult?.definitions) {
        const mapping: Record<string, string> = {};
        for (const def of constitutionResult.definitions) {
          mapping[def.stable_key] = def.category;
        }
        setCategoryMap(mapping);
      }
    } catch {
      setError("Could not load trip details. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [tripId]);

  async function submitRsvp() {
    if (!details || !rsvpChoice) return;
    if (rsvpChoice === "coming" && details.myRsvp?.response !== "coming") {
      if (!details.currentRuleBundle || !acknowledged) {
        setRsvpError("Acknowledge the Camping Constitution before selecting Going.");
        return;
      }
    }
    setRsvpBusy(true);
    setRsvpError(null);
    try {
      const result = await api<{ waitlisted?: boolean; position?: number }>("submit_rsvp", {
        tripId: details.tripId,
        response: rsvpChoice,
        expectedVersion: details.myRsvp?.version ?? 0,
        ...(rsvpChoice === "coming" && details.currentRuleBundle
          ? { bundleId: details.currentRuleBundle.id, contentHash: details.currentRuleBundle.contentHash }
          : {}),
      });
      if (result?.waitlisted) {
        setWaitlistedPosition(result.position ?? null);
      } else {
        setWaitlistedPosition(null);
      }
      await refresh();
      if (rsvpChoice === "coming" && !result?.waitlisted) {
        setShowDutyPromptModal(true);
      }
      setRsvpChoice(null);
      setAcknowledged(false);
    } catch {
      setRsvpError("Response could not be saved. Refresh and try again.");
    } finally {
      setRsvpBusy(false);
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
    } catch {
      setAdminRosterMsg(newResponse === "coming"
        ? "Could not mark Going. The member must have personally acknowledged the constitution, or poll is closed."
        : "Could not update attendance. Try again.");
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
  const rsvpStatusLabel = details.myWaitlistPosition
    ? "Waitlisted"
    : isComing
      ? "Going"
      : isNotComing
        ? "Not Going"
        : "No response";

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

  const eventStatusLabel = details.eventStatus === "confirmed"
    ? "Confirmed"
    : details.eventStatus === "cancelled"
      ? "Cancelled"
      : details.eventStatus === "tentative"
        ? "Tentative"
        : (isDraft
          ? "Pending"
          : details.pollStatus === "open"
            ? (details.cabinBookingStatus === "booked" ? "Confirmed" : "Pending")
            : (details.pollStatus === "closed" ? "Confirmed" : "Pending"));

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
            <span className={`event-status-pill status-${details.eventStatus === "confirmed" ? "confirmed" : details.eventStatus === "cancelled" ? "closed" : isDraft ? "upcoming" : details.pollStatus}`}>
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
              <div style={{ display: "flex", gap: "0.4rem", marginLeft: "auto", flexWrap: "wrap" }}>
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
        {(["overview", "constitution", "logistics", "tasks", "financials"] as Tab[]).map((t) => (
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
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="stack">
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

          <div className="card">
            <h2>RSVP & Attendance</h2>
            <div style={{ marginBottom: "1rem", background: "#f9fafb", padding: "0.85rem", borderRadius: "8px", border: "1px solid #e5e7eb" }}>
              <strong style={{ display: "block", fontSize: "0.85rem", textTransform: "uppercase", color: "#4b5563", letterSpacing: "0.04em", marginBottom: "0.25rem" }}>
                Deposit Obligation
              </strong>
              <span style={{ fontSize: "0.9rem", color: "#4b5563" }}>
                • $50 deposit per attendee due upon confirmation · <em>Payment tracking coming soon</em>
              </span>
            </div>

            <p>
              Your status: <strong>{rsvpStatusLabel}</strong>
            </p>

            {isComing && (
              details.myDailyWorkload?.target != null ? <DailyWorkloadProgress progress={details.myDailyWorkload} /> :
              (details.myDutyCount ?? 0) >= (details.taskQuotaTarget ?? 2) ? (
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
                    setRsvpChoice(details.myRsvp?.response === "coming" && !rsvpChoice ? null : "coming");
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

            {rsvpChoice === "coming" && details.myRsvp?.response !== "coming" && details.currentRuleBundle && (
              <div className="rules-acknowledgment">
                <p>
                  By selecting Going you agree to the current Camping Constitution (version{" "}
                  {details.currentRuleBundle.version}).
                </p>
                <label className="checkbox-label">
                  <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
                  <span>I have read and agree to the Camping Constitution.</span>
                </label>
                <button type="button" onClick={() => void submitRsvp()} disabled={rsvpBusy}>
                  {rsvpBusy ? "Saving…" : "Confirm Going"}
                </button>
              </div>
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
                <div className="attendees-chips-grid">
                  {details.participantEntries.map((e) => (
                    <span key={e.memberId} className="attendee-chip">
                      {e.displayName}
                    </span>
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
        </div>
      )}

      {tab === "constitution" && (
        <div className="stack">
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
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <h2 style={{ margin: 0 }}>Logistics &amp; Packing</h2>
            {isAdmin && (
              <button
                type="button"
                className="secondary-button"
                style={{ fontSize: "0.85rem", padding: "0.3rem 0.75rem" }}
                onClick={() => setShowEditLogistics(true)}
              >
                ✏️ Edit Logistics &amp; Packing
              </button>
            )}
          </div>

          <div style={{ marginBottom: "1.25rem" }}>
            <h3>Trip Notes &amp; Packing Recommendations</h3>
            {details.additionalInformation ? (
              <p style={{ whiteSpace: "pre-wrap" }}>{details.additionalInformation}</p>
            ) : (
              <p style={{ color: "#6b7280" }}>No notes or packing checklist added yet.</p>
            )}
          </div>

          {details.campsite?.reservationInstructions && (
            <div style={{ marginBottom: "1.25rem" }}>
              <h3>Reservation &amp; Check-In Instructions</h3>
              <p style={{ whiteSpace: "pre-wrap" }}>{details.campsite.reservationInstructions}</p>
            </div>
          )}

          {details.campsite?.directions && (
            <div style={{ marginBottom: "1.25rem" }}>
              <h3>Driving &amp; Travel Directions</h3>
              <p style={{ whiteSpace: "pre-wrap" }}>{details.campsite.directions}</p>
            </div>
          )}
        </div>
      )}

      {tab === "financials" && (
        <div className="card">
          <h2>Financials</h2>
          <p>
            Settlement details will be available after the trip is confirmed. Expense tracking is coming in a future
            update.
          </p>
        </div>
      )}

      {tab === "tasks" && (
        <TripTasksAndMealsTab
          tripId={details.tripId}
          isConfirmedAttendee={isComing}
          isAdmin={isAdmin}
          currentMemberId={authProfileMemberId}
          api={api}
          onDutyChanged={refresh}
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
  const [eventStatus, setEventStatus] = useState<"tentative" | "confirmed" | "cancelled">(details.eventStatus ?? "tentative");
  const [bookingStatus, setBookingStatus] = useState<"booked" | "pending">(details.cabinBookingStatus === "booked" ? "booked" : "pending");
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

