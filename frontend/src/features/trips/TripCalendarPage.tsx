import { useEffect, useState } from "react";
import { Link } from "react-router";
import { invokeTripApi, TripApiError } from "../../lib/supabase";
import { formatZonedDateTimeLocal } from "../../domain/calendar";

type Rule = { stable_key: string; text: string; structured_values: Record<string, unknown> };
type Bundle = { id: string; version: number; contentHash: string; rules: Rule[]; createdAt: string };
export type CabinBookingStatus = "booked" | "pending" | "sites_available" | "no_vacancy";
export type EventStatus = "tentative" | "confirmed" | "cancelled";
export type CampingType = "cabin" | "tent" | "rv" | "boat";

type Campsite = {
  campsiteId: string; rotationPosition: number; name: string; availabilityUrl: string | null; locationDescription: string;
  directions: string | null; cabinCapacity: number | null; cabinTypes: string[]; reservationInstructions: string | null;
  estimatedRateCents: number | null; availabilityStatus: string; availabilitySourceUrl: string | null;
  availabilityVerifiedAt: string | null; adminNotes?: string;
  imageUrl?: string | null; campHostName?: string | null; campHostPhone?: string | null;
  campFeatures?: string[]; cabinInformation?: string | null;
  version: number;
};
export type Trip = {
  tripId: string; monthKey: string; rotationPosition: number; suggestedCampsiteId: string; selectedCampsiteId: string;
  startsOn: string | null; endsOn: string | null; clubTimezone: string | null; pollDeadlineAt: string | null;
  minimumParticipants: number; minimumBasis: null; maxCapacity: number | null;
  perCabinCapacity: number; cabinCount: number | null;
  effectiveCapacity: number | null; spotsRemaining: number | null;
  waitlistCount: number; myWaitlistPosition: number | null;
  pollStatus: "draft" | "open" | "closed";
  title?: string | null; eventStatus?: EventStatus; campingType?: CampingType;
  additionalInformation: string; cabinBookingStatus: CabinBookingStatus | null;
  legacyCabinAvailabilityStatus?: string | null; version: number; comingCount: number;
  tripDecision: "none"; currentRuleBundle: Bundle | null;
  myRsvp: null | { response: "coming" | "not_coming"; acknowledgmentId: string | null; version: number; updatedAt: string; acceptedRuleBundle?: Bundle | null };
  myWaitlistEntry?: { position: number; status: string };
  participantEntries?: Array<{ memberId: string; displayName: string; response: "coming" | "not_coming"; version: number; acknowledgmentId: string | null }>;
};
export type Calendar = {
  clubConfiguration: { timezone: string | null; defaultPollLeadDays: number; defaultPollCloseTime: string | null; defaultMinimumParticipants: number; nextMonthToGenerate: string; nextRotationPosition: number; version: number };
  campsites: Campsite[]; trips: Trip[]; members?: Array<{ memberId: string; displayName: string }>;
  withdrawalRequests?: Array<{ requestId: string; tripId: string; memberId: string; displayName: string; reason: string; createdAt: string }>;
};
export type TripApi = <T = unknown>(action: string, input?: unknown, key?: string) => Promise<T>;
type Props = { isAdmin: boolean; api?: TripApi };

const defaultApi: TripApi = (action, input, key) => invokeTripApi(action, input, key);
const cabinBookingStatuses: Array<{ value: CabinBookingStatus; label: string }> = [
  { value: "booked", label: "Booked" },
  { value: "pending", label: "Pending (sites available)" },
];
const eventStatuses: Array<{ value: EventStatus; label: string }> = [
  { value: "tentative", label: "Tentative" },
  { value: "confirmed", label: "Confirmed" },
  { value: "cancelled", label: "Cancelled" },
];
const campingTypes: Array<{ value: CampingType; label: string }> = [
  { value: "cabin", label: "Cabin" },
  { value: "tent", label: "Tent" },
  { value: "rv", label: "RV" },
  { value: "boat", label: "Boat" },
];

function monthName(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function datePlusDays(date: string, days: number): string {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

function ErrorText({ value }: { value: string | null }) {
  return value ? <p role="alert" className="form-error">{value}</p> : null;
}

function TripEditModal({
  trip,
  calendar,
  api,
  onClose,
  onRefresh,
}: {
  trip: Trip;
  calendar?: Calendar;
  api: TripApi;
  onClose: () => void;
  onRefresh: () => Promise<void>;
}) {
  const deadlineLocal = formatZonedDateTimeLocal(trip?.pollDeadlineAt ?? null, trip?.clubTimezone ?? calendar?.clubConfiguration.timezone ?? null);
  const [deadline, setDeadline] = useState(deadlineLocal.slice(0, 10));
  const [deadlineTime, setDeadlineTime] = useState(deadlineLocal.slice(11, 16) || calendar?.clubConfiguration.defaultPollCloseTime?.slice(0, 5) || "18:00");
  const [title, setTitle] = useState(trip?.title ?? "");
  const [startsOn, setStartsOn] = useState(trip?.startsOn ?? "");
  const [endsOn, setEndsOn] = useState(trip?.endsOn ?? "");
  const [minimum, setMinimum] = useState(trip?.minimumParticipants ?? calendar?.clubConfiguration.defaultMinimumParticipants ?? 4);
  const [capacity, setCapacity] = useState(trip?.maxCapacity?.toString() ?? "");
  const [cabinCount, setCabinCount] = useState(trip?.cabinCount?.toString() ?? "");
  const [perCabinCapacity, setPerCabinCapacity] = useState(trip?.perCabinCapacity?.toString() ?? "6");
  const [campingType, setCampingType] = useState<CampingType>(trip?.campingType ?? "cabin");
  const [eventStatus, setEventStatus] = useState<EventStatus>(trip?.eventStatus ?? "tentative");
  const [siteId, setSiteId] = useState(trip?.selectedCampsiteId ?? "");
  const [bookingStatus, setBookingStatus] = useState<CabinBookingStatus | "">(
    trip?.cabinBookingStatus === "booked" ? "booked" : "pending"
  );
  const [information, setInformation] = useState(trip?.additionalInformation ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isClosed = trip?.pollStatus === "closed";
  const [reopenPoll, setReopenPoll] = useState(false);
  const [reopenReason, setReopenReason] = useState("");

  function handleStartsOnChange(newStarts: string) {
    setStartsOn(newStarts);
    if (!endsOn || endsOn < newStarts) {
      setEndsOn(newStarts);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!bookingStatus) { setMsg("Select a Cabin Booking Status before saving."); return; }
    if (reopenPoll && !reopenReason.trim()) {
      setMsg("Please provide an audited reason for extending the registration deadline and reopening the poll.");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const effectiveDeadline = deadline || (startsOn ? datePlusDays(startsOn, -(calendar?.clubConfiguration.defaultPollLeadDays ?? 35)) : "");
      const configRes = await api<{ version: number }>("admin_configure_trip", {
        tripId: trip.tripId,
        startsOn,
        endsOn,
        deadlineDate: effectiveDeadline || null,
        deadlineTime: deadlineTime || null,
        minimumParticipants: Number(minimum),
        maxCapacity: capacity ? Number(capacity) : null,
        cabinCount: cabinCount ? Number(cabinCount) : null,
        perCabinCapacity: perCabinCapacity ? Number(perCabinCapacity) : 6,
        selectedCampsiteId: siteId,
        cabinBookingStatus: bookingStatus,
        additionalInformation: information,
        title: title.trim() || null,
        eventStatus,
        campingType,
        expectedVersion: trip.version,
        reason: reopenPoll
          ? `Administrator extended registration deadline: ${reopenReason.trim()}`
          : "Administrator configured trip from calendar card",
      });

      if (reopenPoll) {
        const nextVersion = configRes?.version ?? (trip.version + 1);
        await api("admin_set_poll_status", {
          tripId: trip.tripId,
          pollStatus: "open",
          expectedVersion: nextVersion,
          reason: `Administrator reopened poll after extending deadline: ${reopenReason.trim()}`,
        });
      }

      await onRefresh();
      onClose();
    } catch (err) {
      if (err instanceof TripApiError && err.status === 409) {
        setMsg("This trip changed while you were editing. Refresh and try again.");
      } else {
        setMsg("Could not save trip configuration. Please verify all inputs.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h2>Edit {trip.title || `${monthName(trip.monthKey)} Camping`}</h2>
        <form className="admin-form" onSubmit={handleSave}>
          <label>Event Name
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={`${monthName(trip.monthKey)} Camping`}
            />
          </label>
          <div className="form-grid">
            <label>Trip start
              <input type="date" required value={startsOn} onChange={(e) => handleStartsOnChange(e.target.value)} />
            </label>
            <label>Trip end
              <input type="date" required min={startsOn || undefined} value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
            </label>
            <label>Camping Type
              <select value={campingType} onChange={(e) => setCampingType(e.target.value as CampingType)}>
                {campingTypes.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </label>
            <label>Event Status
              <select value={eventStatus} onChange={(e) => setEventStatus(e.target.value as EventStatus)}>
                {eventStatuses.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </label>
            <label>Camping Type Sites Count
              <input type="number" min="1" max="50" value={cabinCount} onChange={(e) => setCabinCount(e.target.value)} />
            </label>
            <label>Camping Type Site Capacity
              <input type="number" min="1" max="50" value={perCabinCapacity} onChange={(e) => setPerCabinCapacity(e.target.value)} />
            </label>
            <label>Registration deadline date
              <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </label>
            <label>Deadline time
              <input type="time" value={deadlineTime} onChange={(e) => setDeadlineTime(e.target.value)} />
            </label>
            <label>Minimum participants
              <input type="number" min="1" max="100" required value={minimum} onChange={(e) => setMinimum(Number(e.target.value))} />
            </label>
            <label>Max capacity (optional)
              <input type="number" min="1" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
            </label>
          </div>
          <label>Selected campsite
            <select value={siteId} onChange={(e) => setSiteId(e.target.value)}>
              {calendar?.campsites.map((s) => (
                <option key={s.campsiteId} value={s.campsiteId}>{s.name}</option>
              ))}
            </select>
          </label>
          <label>Cabin Booking Status
            <select required value={bookingStatus} onChange={(e) => setBookingStatus(e.target.value as CabinBookingStatus)}>
              {cabinBookingStatuses.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </label>
          <label>Trip notes & information
            <textarea value={information} onChange={(e) => setInformation(e.target.value)} />
          </label>
          {isClosed && (
            <div style={{ background: "#fef3c7", padding: "0.75rem", borderRadius: "6px", border: "1px solid #fde68a", margin: "0.5rem 0" }}>
              <label className="checkbox-label" style={{ fontWeight: 600, color: "#92400e" }}>
                <input
                  type="checkbox"
                  checked={reopenPoll}
                  onChange={(e) => setReopenPoll(e.target.checked)}
                />
                Extend registration deadline &amp; Reopen Poll
              </label>
              {reopenPoll && (
                <label style={{ marginTop: "0.5rem", display: "block" }}>
                  Audited Reopening Reason *
                  <input
                    type="text"
                    required
                    placeholder="e.g. Extended registration by 5 days per committee request"
                    value={reopenReason}
                    onChange={(e) => setReopenReason(e.target.value)}
                  />
                </label>
              )}
            </div>
          )}
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

function EventCard({
  trip,
  campsite,
  calendar,
  isAdmin,
  api,
  onRefresh,
}: {
  trip: Trip;
  campsite: Campsite | undefined;
  calendar?: Calendar;
  isAdmin: boolean;
  api: TripApi;
  onRefresh: () => Promise<void>;
}) {
  const [choice, setChoice] = useState<"coming" | "not_coming" | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [withdrawalReason, setWithdrawalReason] = useState("");
  const [withdrawalMessage, setWithdrawalMessage] = useState<string | null>(null);
  const [waitlistedPosition, setWaitlistedPosition] = useState<number | null>(null);

  const isDraft = trip.pollStatus === "draft";
  const isOpen =
    trip.pollStatus === "open" &&
    Boolean(trip.pollDeadlineAt) &&
    new Date(trip.pollDeadlineAt as string).getTime() > Date.now();
  const isComing = trip.myRsvp?.response === "coming";
  const isNotComing = trip.myRsvp?.response === "not_coming";
  const needsAcknowledgment = choice === "coming" && !isComing;

  const dateLabel = !trip.startsOn || !trip.endsOn ? "Dates TBA" : `${trip.startsOn} – ${trip.endsOn}`;

  async function submit() {
    if (!choice) return;
    if (needsAcknowledgment && (!trip.currentRuleBundle || !acknowledged)) {
      setError("Acknowledge the Camping Constitution before selecting Going.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ waitlisted?: boolean; position?: number }>("submit_rsvp", {
        tripId: trip.tripId,
        response: choice,
        expectedVersion: trip.myRsvp?.version ?? 0,
        ...(choice === "coming" && trip.currentRuleBundle
          ? { bundleId: trip.currentRuleBundle.id, contentHash: trip.currentRuleBundle.contentHash }
          : {}),
      });
      if (result?.waitlisted) {
        setWaitlistedPosition(result.position ?? null);
      } else {
        setWaitlistedPosition(null);
      }
      await onRefresh();
      setChoice(null);
      setAcknowledged(false);
    } catch {
      setError("Response could not be saved. The poll may have changed — refresh and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteTrip() {
    const tripDisplayName = trip.title || `${monthName(trip.monthKey)} Camping`;
    const confirmed = window.confirm(
      `Are you sure you want to delete "${tripDisplayName}"? This action removes the event and will not recreate it.`
    );
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    try {
      await api("admin_delete_trip", {
        tripId: trip.tripId,
        reason: `Administrator deleted trip: ${tripDisplayName}`,
      });
      await onRefresh();
    } catch (err: unknown) {
      const msg =
        err instanceof TripApiError && err.message && err.message !== "The trip request could not be completed."
          ? err.message
          : ((err as Error)?.message || "Could not delete this camping event.");
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function requestWithdrawal(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setWithdrawalMessage(null);
    try {
      const result = await api<{ state: string }>("request_withdrawal", {
        tripId: trip.tripId,
        reason: withdrawalReason,
      });
      setWithdrawalMessage(
        result.state === "pending_owner_policy"
          ? "Request recorded for administrator review. Your effective poll response remains Coming until the withdrawal policy is approved."
          : "Withdrawal request recorded."
      );
      setWithdrawalReason("");
      await onRefresh();
    } catch {
      setWithdrawalMessage("The request could not be saved. It may already be pending or the poll state may have changed.");
    } finally {
      setBusy(false);
    }
  }

  const [showEditModal, setShowEditModal] = useState(false);

  const eventStatusLabel = trip.eventStatus === "confirmed"
    ? "Confirmed"
    : trip.eventStatus === "cancelled"
      ? "Cancelled"
      : trip.eventStatus === "tentative"
        ? "Tentative"
        : (isDraft
          ? "Pending"
          : trip.pollStatus === "open"
            ? (trip.cabinBookingStatus === "booked" ? "Confirmed" : "Pending")
            : (trip.pollStatus === "closed" ? "Confirmed" : "Pending"));

  const formattedDeadlinePST = trip.pollDeadlineAt
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Los_Angeles",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      }).format(new Date(trip.pollDeadlineAt))
    : null;

  const campingTypeLabel = trip.campingType
    ? trip.campingType.charAt(0).toUpperCase() + trip.campingType.slice(1)
    : "Cabin";

  return (
    <article className="event-card-container" aria-label={`Trip ${dateLabel}`}>
      <div className="event-card-header">
        <div style={{ display: "flex", gap: "0.85rem", alignItems: "flex-start" }}>
          {campsite?.imageUrl && (
            <img
              src={campsite.imageUrl}
              alt={campsite.name}
              style={{
                width: "75px",
                height: "75px",
                aspectRatio: "1 / 1",
                objectFit: "cover",
                borderRadius: "8px",
                border: "1px solid #e5e7eb",
                flexShrink: 0,
              }}
            />
          )}
          <div>
            <p className="eyebrow">{monthName(trip.monthKey)}</p>
            <h2 className="event-card-name">
              {trip.title || trip.additionalInformation || `${monthName(trip.monthKey)} Camping`}
            </h2>
            {campsite && (
              <p className="event-card-campsite">
                {campsite.name}{campsite.locationDescription ? ` · ${campsite.locationDescription}` : ""}
              </p>
            )}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          {isAdmin && (
            <div style={{ display: "flex", gap: "0.35rem" }}>
              <button
                type="button"
                className="secondary-button"
                style={{ padding: "0.2rem 0.55rem", fontSize: "0.78rem" }}
                onClick={() => setShowEditModal(true)}
              >
                ✏️ Edit
              </button>
              <button
                type="button"
                className="secondary-button"
                style={{ padding: "0.2rem 0.55rem", fontSize: "0.78rem", color: "#dc2626", borderColor: "#fca5a5" }}
                disabled={busy}
                onClick={() => void handleDeleteTrip()}
              >
                🗑️ Delete
              </button>
            </div>
          )}
          <span className="badge-pill" style={{ fontSize: "0.78rem", background: "#f3f4f6", color: "#374151" }}>
            🏕️ {campingTypeLabel}
          </span>
          <span className={`event-status-pill status-${trip.eventStatus === "confirmed" ? "confirmed" : trip.eventStatus === "cancelled" ? "closed" : isDraft ? "upcoming" : trip.pollStatus}`}>
            Event Status: {eventStatusLabel}
          </span>
        </div>
      </div>

      <div className="event-card-date-row">
        <span>📅</span>
        <span>{dateLabel} {trip.startsOn ? "(Pacific Time)" : ""}</span>
        {formattedDeadlinePST && (
          <span style={{ fontSize: "0.82rem", color: "#6b7280", marginLeft: "0.5rem" }}>
            · Deadline: {formattedDeadlinePST}
          </span>
        )}
      </div>

      <div style={{ display: "grid", gap: "0.5rem", margin: "0.75rem 0", background: "#f9fafb", padding: "0.75rem", borderRadius: "8px", border: "1px solid #e5e7eb" }}>
        <div>
          <strong style={{ display: "block", fontSize: "0.8rem", textTransform: "uppercase", color: "#4b5563", letterSpacing: "0.04em" }}>
            {campingTypeLabel} Booking
          </strong>
          <span style={{ fontSize: "0.9rem", color: "#111827" }}>
            • {trip.cabinCount ?? 0} {campingTypeLabel} Sites Booked | Capacity: {trip.effectiveCapacity ?? (trip.cabinCount ? trip.cabinCount * trip.perCabinCapacity : "—")}
          </span>
          {trip.cabinCount != null && <span className="sr-only">{trip.cabinCount} sites booked</span>}
          {trip.effectiveCapacity != null && <span className="sr-only">Capacity: {trip.effectiveCapacity}</span>}
        </div>
        <div>
          <strong style={{ display: "block", fontSize: "0.8rem", textTransform: "uppercase", color: "#4b5563", letterSpacing: "0.04em" }}>
            Attendance &amp; RSVP
          </strong>
          <span style={{ fontSize: "0.9rem", color: "#111827" }}>
            • {trip.comingCount} Confirmed | {trip.spotsRemaining ?? 0} Spots Remaining
          </span>
          <span className="sr-only">{trip.comingCount} confirmed</span>
          {trip.spotsRemaining != null && <span className="sr-only">{trip.spotsRemaining} spots remaining</span>}
          {trip.waitlistCount > 0 && <span className="sr-only">{trip.waitlistCount} on waitlist</span>}
        </div>
      </div>

      {!isDraft && (
        <div className="rsvp-section">
          <p className="rsvp-label">Your RSVP</p>
          <div className="rsvp-pills">
            <button
              type="button"
              disabled={!isOpen}
              aria-label={!choice && isComing ? "Going ✓" : "Going"}
              className={`rsvp-pill-btn ${choice === "coming" || (!choice && isComing) ? "active selected" : ""}`}
              onClick={() => {
                if (!isOpen) return;
                setChoice(isComing && !choice ? null : "coming");
                setError(null);
              }}
            >
              {!choice && isComing ? "Yes, Going ✓" : "Yes, Going"}
            </button>
            <button
              type="button"
              disabled={!isOpen}
              aria-label="Not Going"
              className={`rsvp-pill-btn ${choice === "not_coming" || (!choice && isNotComing) ? "active selected" : ""}`}
              onClick={() => {
                if (!isOpen) return;
                setChoice(isNotComing && !choice ? null : "not_coming");
                setAcknowledged(false);
                setError(null);
              }}
            >
              No, Not Going
            </button>
          </div>
        </div>
      )}

      {isDraft && (
        <p style={{ margin: 0, fontSize: "0.88rem", color: "#6b7280" }}>
          RSVP: Not answered
        </p>
      )}

      <div className="event-card-footer">
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <span style={{ fontSize: "0.82rem", color: "#6b7280" }}>RSVP:</span>
          {isComing && <span className="status-badge-going status-chip status-coming">Going</span>}
          {isNotComing && <span className="status-badge-not-going status-chip status-not_coming">Not Going</span>}
          {trip.myWaitlistPosition && (
            <span className="status-badge-not-going status-chip status-waitlisted">Waitlisted</span>
          )}
          {!isComing && !isNotComing && !trip.myWaitlistPosition && (
            <span className="status-chip status-none">No response</span>
          )}
        </div>
        <Link to={`/trips/${trip.tripId}`} className="view-details-link">
          View details &gt;
        </Link>
      </div>

      {choice === "coming" && needsAcknowledgment && trip.currentRuleBundle && (
        <section className="rules-acknowledgment" aria-label="Camping Constitution acknowledgment">
          <h3>Camping Constitution · version {trip.currentRuleBundle.version}</h3>
          <div className="rules-list">
            {trip.currentRuleBundle.rules.map((rule) => (
              <article key={rule.stable_key}>
                <h4>{rule.stable_key.replaceAll("-", " ")}</h4>
                <p>{rule.text}</p>
              </article>
            ))}
          </div>
          <label className="checkbox-label">
            <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
            <span>I have read and agree to the Camping Constitution shown above.</span>
          </label>
          <button type="button" onClick={() => void submit()} disabled={busy}>
            {busy ? "Saving…" : "Confirm Going"}
          </button>
        </section>
      )}

      {choice === "not_coming" && (
        <div className="not-coming-submit">
          <button type="button" onClick={() => void submit()} disabled={busy}>
            {busy ? "Saving…" : "Confirm Not Going"}
          </button>
        </div>
      )}

      {trip.myRsvp?.response === "coming" && trip.myRsvp.acceptedRuleBundle && (
        <details className="accepted-rules">
          <summary>View the exact rules version you accepted</summary>
          <p>
            You accepted Constitution version {trip.myRsvp.acceptedRuleBundle.version} ·{" "}
            {trip.myRsvp.acceptedRuleBundle.contentHash.slice(0, 12)}
          </p>
          <div className="rules-list">
            {trip.myRsvp.acceptedRuleBundle.rules.map((rule) => (
              <article key={rule.stable_key}>
                <h4>{rule.stable_key.replaceAll("-", " ")}</h4>
                <p>{rule.text}</p>
              </article>
            ))}
          </div>
        </details>
      )}

      {!isDraft && !isOpen && (
        <p role="status">
          {trip.pollStatus === "closed"
            ? "This poll is closed."
            : "This poll has passed its deadline and is closing. You can contact an administrator."}
        </p>
      )}

      {trip.pollStatus === "closed" && trip.myRsvp?.response === "coming" && (
        <form className="withdrawal-request" onSubmit={(event) => void requestWithdrawal(event)}>
          <h3>Request a withdrawal</h3>
          <p>
            Because the poll is closed, your request will be recorded for administrator review. This will not change
            the current response.
          </p>
          <label>
            Reason
            <textarea
              required
              minLength={1}
              maxLength={500}
              value={withdrawalReason}
              onChange={(event) => setWithdrawalReason(event.target.value)}
            />
          </label>
          <button disabled={busy}>Submit withdrawal request</button>
          {withdrawalMessage && <p role="status">{withdrawalMessage}</p>}
        </form>
      )}

      {waitlistedPosition !== null && (
        <p role="status">
          You are #{waitlistedPosition} on the waitlist. The administrator will notify you if a spot opens.
        </p>
      )}

      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}

      {showEditModal && (
        <TripEditModal
          trip={trip}
          calendar={calendar}
          api={api}
          onClose={() => setShowEditModal(false)}
          onRefresh={onRefresh}
        />
      )}
    </article>
  );
}

function AddCustomCampingModal({
  calendar,
  api,
  onClose,
  onRefresh,
}: {
  calendar: Calendar;
  api: TripApi;
  onClose: () => void;
  onRefresh: () => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [campingType, setCampingType] = useState<CampingType>("cabin");
  const [eventStatus, setEventStatus] = useState<EventStatus>("tentative");
  const [bookingStatus, setBookingStatus] = useState<CabinBookingStatus>("pending");
  const [sitesCount, setSitesCount] = useState("2");
  const [siteCapacity, setSiteCapacity] = useState("6");
  const [siteId, setSiteId] = useState(calendar.campsites[0]?.campsiteId || "");
  const [minimum, setMinimum] = useState(4);
  const [information, setInformation] = useState("");
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
    if (!title.trim()) {
      setMsg("Please enter an event name.");
      return;
    }
    if (!startsOn || !endsOn) {
      setMsg("Please provide start and end dates.");
      return;
    }
    if (endsOn < startsOn) {
      setMsg("Trip end date cannot be earlier than start date.");
      return;
    }
    if (!siteId) {
      setMsg("Please select a campsite.");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const deadlineDate = startsOn ? datePlusDays(startsOn, -(calendar.clubConfiguration.defaultPollLeadDays ?? 35)) : null;
      await api("admin_create_custom_trip", {
        title: title.trim(),
        startsOn,
        endsOn,
        selectedCampsiteId: siteId,
        campingType,
        sitesCount: Number(sitesCount) || 2,
        siteCapacity: Number(siteCapacity) || 6,
        eventStatus,
        cabinBookingStatus: bookingStatus,
        bookingStatus,
        minimumParticipants: Number(minimum) || 4,
        maxCapacity: null,
        deadlineDate,
        deadlineTime: calendar.clubConfiguration.defaultPollCloseTime?.slice(0, 5) || "18:00",
        additionalInformation: information,
        reason: "Administrator created custom camping event",
      });
      await onRefresh();
      onClose();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Could not save custom camping trip. Please check inputs.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h2>Add Custom Camping Event</h2>
        <p style={{ color: "#6b7280", fontSize: "0.9rem" }}>
          Create a new camping trip with custom event dates, campsite, and booking status.
        </p>
        <form className="admin-form" onSubmit={handleSave}>
          <label>
            Event Name *
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Winter Cabin Getaway, Spring Lake Camp"
            />
          </label>
          <div className="form-grid">
            <label>
              Trip start date *
              <input type="date" required value={startsOn} onChange={(e) => handleStartsOnChange(e.target.value)} />
            </label>
            <label>
              Trip end date *
              <input type="date" required min={startsOn || undefined} value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
            </label>
            <label>
              Camping Type
              <select value={campingType} onChange={(e) => setCampingType(e.target.value as CampingType)}>
                {campingTypes.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </label>
            <label>
              Event Status
              <select value={eventStatus} onChange={(e) => setEventStatus(e.target.value as EventStatus)}>
                {eventStatuses.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </label>
            <label>
              Camping Type Sites Count
              <input type="number" min="1" max="50" required value={sitesCount} onChange={(e) => setSitesCount(e.target.value)} />
            </label>
            <label>
              Camping Type Site Capacity
              <input type="number" min="1" max="50" required value={siteCapacity} onChange={(e) => setSiteCapacity(e.target.value)} />
            </label>
            <label>
              Minimum participants
              <input type="number" min="1" max="100" required value={minimum} onChange={(e) => setMinimum(Number(e.target.value))} />
            </label>
          </div>
          <label>
            Selected campsite
            <select value={siteId} onChange={(e) => setSiteId(e.target.value)}>
              {calendar.campsites.map((s) => (
                <option key={s.campsiteId} value={s.campsiteId}>{s.name} ({s.locationDescription})</option>
              ))}
            </select>
          </label>
          <label>
            Cabin Booking Status
            <select required value={bookingStatus} onChange={(e) => setBookingStatus(e.target.value as CabinBookingStatus)}>
              {cabinBookingStatuses.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </label>
          <label>
            Trip notes &amp; information
            <textarea
              placeholder="Custom trip notes, location details, special instructions..."
              value={information}
              onChange={(e) => setInformation(e.target.value)}
            />
          </label>
          {msg && <p role="alert" className="form-error">{msg}</p>}
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
            <button type="submit" disabled={busy}>{busy ? "Saving…" : "Save Custom Camping"}</button>
            <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}





export function sortTrips(a: Trip, b: Trip): number {
  const aIsDraft = a.pollStatus === "draft";
  const bIsDraft = b.pollStatus === "draft";

  if (aIsDraft !== bIsDraft) {
    return aIsDraft ? 1 : -1;
  }

  if (aIsDraft) {
    const monthCmp = a.monthKey.localeCompare(b.monthKey);
    if (monthCmp !== 0) return monthCmp;
    if (a.startsOn && b.startsOn) return a.startsOn.localeCompare(b.startsOn);
    if (a.startsOn) return -1;
    if (b.startsOn) return 1;
    return 0;
  }

  if (!a.startsOn && !b.startsOn) return a.monthKey.localeCompare(b.monthKey);
  if (!a.startsOn) return 1;
  if (!b.startsOn) return -1;
  const startCmp = a.startsOn.localeCompare(b.startsOn);
  if (startCmp !== 0) return startCmp;
  return a.monthKey.localeCompare(b.monthKey);
}

export function TripCalendarPage({ isAdmin, api = defaultApi }: Props) {
  const [calendar, setCalendar] = useState<Calendar | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddCustomModal, setShowAddCustomModal] = useState(false);

  async function refresh() {
    setError(null);
    try {
      setCalendar(await api<Calendar>("get_calendar"));
    } catch {
      setError("The trip calendar could not be loaded. Please try again.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);

  return (
    <section className="trip-page">
      <div className="feed-header">
        <div>
          <h1 className="feed-title">Upcoming Camping</h1>
          <span className="badge-pill">12 months</span>
        </div>
        {isAdmin && (
          <button
            type="button"
            className="secondary-button"
            onClick={() => setShowAddCustomModal(true)}
          >
            + Add Custom Camping
          </button>
        )}
      </div>

      {loading && <p role="status">Loading camping calendar…</p>}
      {error && (
        <div className="card">
          <ErrorText value={error} />
          <button className="secondary-button" onClick={() => void refresh()}>
            Try again
          </button>
        </div>
      )}

      {calendar && (
        <div className="stack">
          {[...calendar.trips]
            .sort(sortTrips)
            .map((trip) => (
              <EventCard
                key={trip.tripId}
                trip={trip}
                campsite={calendar.campsites.find((s) => s.campsiteId === trip.selectedCampsiteId)}
                calendar={calendar}
                isAdmin={isAdmin}
                api={api}
                onRefresh={refresh}
              />
            ))}
        </div>
      )}

      {showAddCustomModal && calendar && (
        <AddCustomCampingModal
          calendar={calendar}
          api={api}
          onClose={() => setShowAddCustomModal(false)}
          onRefresh={refresh}
        />
      )}
    </section>
  );
}
