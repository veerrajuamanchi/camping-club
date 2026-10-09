import { useEffect, useState } from "react";
import { invokeTripApi, TripApiError } from "../../lib/supabase";
import { formatZonedDateTimeLocal } from "../../domain/calendar";

type Rule = { stable_key: string; text: string; structured_values: Record<string, unknown> };
type Bundle = { id: string; version: number; contentHash: string; rules: Rule[]; createdAt: string };
type CabinBookingStatus = "booked" | "no_vacancy" | "sites_available";
type Campsite = {
  campsiteId: string; rotationPosition: number; name: string; availabilityUrl: string | null; locationDescription: string;
  directions: string | null; cabinCapacity: number | null; cabinTypes: string[]; reservationInstructions: string | null;
  estimatedRateCents: number | null; availabilityStatus: string; availabilitySourceUrl: string | null;
  availabilityVerifiedAt: string | null; adminNotes?: string; version: number;
};
type Trip = {
  tripId: string; monthKey: string; rotationPosition: number; suggestedCampsiteId: string; selectedCampsiteId: string;
  startsOn: string | null; endsOn: string | null; clubTimezone: string | null; pollDeadlineAt: string | null;
  minimumParticipants: number; minimumBasis: null; maxCapacity: number | null; pollStatus: "draft" | "open" | "closed";
  additionalInformation: string; cabinBookingStatus: CabinBookingStatus | null; legacyCabinAvailabilityStatus?: string | null; version: number; comingCount: number;
  tripDecision: "none"; currentRuleBundle: Bundle | null;
  myRsvp: null | { response: "coming" | "not_coming"; acknowledgmentId: string | null; version: number; updatedAt: string; acceptedRuleBundle?: Bundle | null };
  participantEntries?: Array<{ memberId: string; displayName: string; response: "coming" | "not_coming"; version: number; acknowledgmentId: string | null }>;
};
export type Calendar = {
  clubConfiguration: { timezone: string | null; defaultPollLeadDays: number; defaultPollCloseTime: string | null; defaultMinimumParticipants: number; nextMonthToGenerate: string; nextRotationPosition: number; version: number };
  campsites: Campsite[]; trips: Trip[]; members?: Array<{ memberId: string; displayName: string }>;
  withdrawalRequests?: Array<{ requestId: string; tripId: string; memberId: string; displayName: string; reason: string; createdAt: string }>;
};
export type TripApi = <T = unknown>(action: string, input?: unknown, key?: string) => Promise<T>;
type Props = { isAdmin: boolean; api?: TripApi };
type Tab = "calendar" | "campsites" | "constitution";

const defaultApi: TripApi = (action, input, key) => invokeTripApi(action, input, key);
const campsiteAvailabilityStatuses = ["unknown", "available", "limited", "unavailable", "manual_confirmation"] as const;
const cabinBookingStatuses: Array<{ value: CabinBookingStatus; label: string }> = [
  { value: "booked", label: "Booked" },
  { value: "no_vacancy", label: "No vacancy" },
  { value: "sites_available", label: "Sites available" },
];
const categories = ["participation", "transport", "cabin", "expenses", "lodging", "meals", "conduct", "custom"] as const;

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

function TripPollCard({ trip, api, onRefresh }: { trip: Trip; api: TripApi; onRefresh: () => Promise<void> }) {
  const [choice, setChoice] = useState<"coming" | "not_coming" | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [withdrawalReason, setWithdrawalReason] = useState("");
  const [withdrawalMessage, setWithdrawalMessage] = useState<string | null>(null);
  const isOpen = trip.pollStatus === "open" && Boolean(trip.pollDeadlineAt) && new Date(trip.pollDeadlineAt as string).getTime() > Date.now();
  const rules = trip.currentRuleBundle?.rules ?? [];
  const needsAcknowledgment = choice === "coming" && trip.myRsvp?.response !== "coming";

  async function submit() {
    if (!choice) return;
    if (needsAcknowledgment && (!trip.currentRuleBundle || !acknowledged)) {
      setError("Acknowledge the current Camping Constitution before selecting Coming.");
      return;
    }
    setBusy(true); setError(null);
    try {
      await api("submit_rsvp", {
        tripId: trip.tripId, response: choice, expectedVersion: trip.myRsvp?.version ?? 0,
        ...(choice === "coming" && trip.currentRuleBundle ? { bundleId: trip.currentRuleBundle.id, contentHash: trip.currentRuleBundle.contentHash } : {}),
      });
      setChoice(null); setAcknowledged(false);
      await onRefresh();
    } catch {
      setError("Your response could not be saved. Refresh and try again; the poll may have closed or changed.");
    } finally { setBusy(false); }
  }

  async function requestWithdrawal(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setWithdrawalMessage(null);
    try {
      const result = await api<{ state: string }>("request_withdrawal", { tripId: trip.tripId, reason: withdrawalReason });
      setWithdrawalMessage(result.state === "pending_owner_policy" ? "Request recorded for administrator review. Your effective poll response remains Coming until the withdrawal policy is approved." : "Withdrawal request recorded.");
      setWithdrawalReason(""); await onRefresh();
    } catch { setWithdrawalMessage("The request could not be saved. It may already be pending or the poll state may have changed."); }
    finally { setBusy(false); }
  }

  return <article className="card trip-card">
    <div className="trip-card-head"><div><p className="eyebrow">{monthName(trip.monthKey)} · campsite rotation {trip.rotationPosition}</p><h2>{trip.startsOn && trip.endsOn ? `${trip.startsOn} – ${trip.endsOn}` : "Dates to be announced"}</h2></div><span className={`status-chip status-${trip.pollStatus}`}>{trip.pollStatus === "open" ? "Interest poll open" : trip.pollStatus}</span></div>
    <p className="trip-summary">{trip.additionalInformation || "Trip details will be shared by an administrator."}</p>
    <div className="trip-meta"><span>{trip.comingCount} Coming responses</span><span>{trip.pollDeadlineAt ? `Closes ${new Date(trip.pollDeadlineAt).toLocaleString()}` : "Deadline not set"}</span><span>Cabin Booking Status: {cabinBookingStatuses.find((status) => status.value === trip.cabinBookingStatus)?.label ?? "Not set"}</span><span>{trip.currentRuleBundle ? `Rules version ${trip.currentRuleBundle.version}` : "Rules being prepared"}</span></div>
    <p className="interest-notice"><strong>Interest only.</strong> A Coming response records interest and acknowledges the displayed rules. It does not confirm the trip or create a payment obligation.</p>
    {trip.myRsvp && <p className="saved-response">Your current response: <strong>{trip.myRsvp.response === "coming" ? "Coming" : "Not Coming"}</strong>{trip.myRsvp.acceptedRuleBundle ? ` · you accepted Constitution version ${trip.myRsvp.acceptedRuleBundle.version}` : ""}</p>}
    {trip.myRsvp?.response === "coming" && trip.myRsvp.acceptedRuleBundle && <details className="accepted-rules"><summary>View the exact rules version you accepted</summary><p>Constitution version {trip.myRsvp.acceptedRuleBundle.version} · {trip.myRsvp.acceptedRuleBundle.contentHash.slice(0, 12)}</p><div className="rules-list">{trip.myRsvp.acceptedRuleBundle.rules.map((rule) => <article key={rule.stable_key}><h4>{rule.stable_key.replaceAll("-", " ")}</h4><p>{rule.text}</p></article>)}</div></details>}
    {isOpen && <>
      <div className="response-actions"><button type="button" className={choice === "coming" || (!choice && trip.myRsvp?.response === "coming") ? "selected" : "secondary-button"} onClick={() => { if (trip.myRsvp?.response === "coming") setChoice(null); else setChoice("coming"); setError(null); }}>{trip.myRsvp?.response === "coming" && !choice ? "Your response: Coming" : "Coming"}</button><button type="button" className={choice === "not_coming" ? "selected" : "secondary-button"} onClick={() => { setChoice("not_coming"); setAcknowledged(false); setError(null); }}>Not Coming</button></div>
      {choice === "coming" && needsAcknowledgment && <section className="rules-acknowledgment" aria-label="Camping Constitution acknowledgment"><h3>Camping Constitution · version {trip.currentRuleBundle?.version}</h3><div className="rules-list">{rules.map((rule) => <article key={rule.stable_key}><h4>{rule.stable_key.replaceAll("-", " ")}</h4><p>{rule.text}</p></article>)}</div><label className="checkbox-label"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /> <span>I have read and agree to the applicable rules shown above.</span></label><button type="button" onClick={() => void submit()} disabled={busy}>{busy ? "Saving…" : "Submit Coming response"}</button></section>}
      {choice === "not_coming" && <div className="not-coming-submit"><button type="button" onClick={() => void submit()} disabled={busy}>{busy ? "Saving…" : "Submit Not Coming response"}</button></div>}
    </>}
    {!isOpen && trip.pollStatus === "open" && <p role="status">This poll has passed its deadline and is closing. You can contact an administrator.</p>}
    {trip.pollStatus === "closed" && trip.myRsvp?.response === "coming" && <form className="withdrawal-request" onSubmit={(event) => void requestWithdrawal(event)}><h3>Request a withdrawal</h3><p>Because the poll is closed, your request will be recorded for administrator review. This will not change the current response.</p><label>Reason<textarea required minLength={1} maxLength={500} value={withdrawalReason} onChange={(event) => setWithdrawalReason(event.target.value)} /></label><button disabled={busy}>Submit withdrawal request</button>{withdrawalMessage && <p role="status">{withdrawalMessage}</p>}</form>}
    <ErrorText value={error} />
  </article>;
}

function CampsiteManager({ calendar, api, onRefresh }: { calendar: Calendar; api: TripApi; onRefresh: () => Promise<void> }) {
  const [selected, setSelected] = useState(calendar.campsites[0]?.campsiteId ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const site = calendar.campsites.find((row) => row.campsiteId === selected) ?? calendar.campsites[0];
  const [name, setName] = useState(site?.name ?? "");
  const [url, setUrl] = useState(site?.availabilityUrl ?? "");
  const [location, setLocation] = useState(site?.locationDescription ?? "");
  const [directions, setDirections] = useState(site?.directions ?? "");
  const [capacity, setCapacity] = useState(site?.cabinCapacity?.toString() ?? "");
  const [types, setTypes] = useState(site?.cabinTypes.join(", ") ?? "");
  const [instructions, setInstructions] = useState(site?.reservationInstructions ?? "");
  const [rate, setRate] = useState(site?.estimatedRateCents == null ? "" : (site.estimatedRateCents / 100).toFixed(2));
  const [status, setStatus] = useState(site?.availabilityStatus ?? "unknown");
  const [sourceUrl, setSourceUrl] = useState(site?.availabilitySourceUrl ?? "");
  const [notes, setNotes] = useState(site?.adminNotes ?? "");
  const [rotation, setRotation] = useState<string[]>([...calendar.campsites].sort((a, b) => a.rotationPosition - b.rotationPosition).map((row) => row.campsiteId));

  useEffect(() => {
    const current = calendar.campsites.find((row) => row.campsiteId === selected) ?? calendar.campsites[0];
    if (!current) return;
    setName(current.name); setUrl(current.availabilityUrl ?? ""); setLocation(current.locationDescription); setDirections(current.directions ?? "");
    setCapacity(current.cabinCapacity?.toString() ?? ""); setTypes(current.cabinTypes.join(", ")); setInstructions(current.reservationInstructions ?? "");
    setRate(current.estimatedRateCents == null ? "" : (current.estimatedRateCents / 100).toFixed(2)); setStatus(current.availabilityStatus);
    setSourceUrl(current.availabilitySourceUrl ?? ""); setNotes(current.adminNotes ?? "");
  }, [calendar.campsites, selected]);

  async function saveSite(event: React.FormEvent) {
    event.preventDefault(); if (!site) return;
    setBusy(true); setMessage(null);
    try {
      await api("admin_update_campsite", {
        campsiteId: site.campsiteId, expectedVersion: site.version, name, availabilityUrl: url || null,
        locationDescription: location, directions: directions || null, cabinCapacity: capacity ? Number(capacity) : null,
        cabinTypes: types.split(",").map((value) => value.trim()).filter(Boolean), reservationInstructions: instructions || null,
        estimatedRateCents: rate ? Math.round(Number(rate) * 100) : null, availabilityStatus: status,
        availabilitySourceUrl: sourceUrl || null, availabilityVerifiedAt: null, adminNotes: notes, reason: "Campsite catalog update",
      });
      await onRefresh(); setMessage("Campsite details saved.");
    } catch { setMessage("Could not save campsite. Refresh and check for a newer edit."); }
    finally { setBusy(false); }
  }

  async function saveRotation() {
    setBusy(true); setMessage(null);
    try { await api("admin_reorder_campsites", { order: rotation, nextRotationPosition: calendar.clubConfiguration.nextRotationPosition, reason: "Campsite rotation update" }); await onRefresh(); setMessage("Round-robin order saved."); }
    catch { setMessage("Could not save rotation order."); }
    finally { setBusy(false); }
  }

  function moveSite(id: string, delta: number) {
    const from = rotation.indexOf(id); const to = Math.max(0, Math.min(rotation.length - 1, from + delta));
    if (from < 0 || from === to) return;
    const next = [...rotation]; next.splice(from, 1); next.splice(to, 0, id); setRotation(next);
  }

  return <section className="admin-workspace stack"><div className="card"><p className="eyebrow">Rotation</p><h2>Round-robin campsite order</h2><ol className="rotation-list">{rotation.map((id, index) => { const row = calendar.campsites.find((siteRow) => siteRow.campsiteId === id); return <li key={id}><span><strong>{index + 1}.</strong> {row?.name}</span><div><button type="button" className="icon-button" aria-label={`Move ${row?.name} up`} onClick={() => moveSite(id, -1)} disabled={index === 0}>↑</button><button type="button" className="icon-button" aria-label={`Move ${row?.name} down`} onClick={() => moveSite(id, 1)} disabled={index === rotation.length - 1}>↓</button></div></li>; })}</ol><button type="button" onClick={() => void saveRotation()} disabled={busy}>Save rotation</button></div>
    <div className="card"><label>Choose campsite<select value={selected} onChange={(event) => setSelected(event.target.value)}>{calendar.campsites.map((row) => <option key={row.campsiteId} value={row.campsiteId}>{row.name}</option>)}</select></label><form onSubmit={(event) => void saveSite(event)} className="admin-form"><h2>Campsite details</h2><label>Name<input required value={name} onChange={(event) => setName(event.target.value)} /></label><label>Availability / reservation URL<input type="url" value={url} onChange={(event) => setUrl(event.target.value)} /></label><label>Location description<textarea value={location} onChange={(event) => setLocation(event.target.value)} /></label><label>Directions<textarea value={directions} onChange={(event) => setDirections(event.target.value)} /></label><div className="form-grid"><label>Cabin capacity<input type="number" min="1" value={capacity} onChange={(event) => setCapacity(event.target.value)} /></label><label>Estimated nightly rate ($)<input type="number" min="0" step="0.01" value={rate} onChange={(event) => setRate(event.target.value)} /></label></div><label>Cabin types, comma separated<input value={types} onChange={(event) => setTypes(event.target.value)} /></label><label>Reservation instructions<textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} /></label><div className="form-grid"><label>Campsite availability status<select value={status} onChange={(event) => setStatus(event.target.value)}>{campsiteAvailabilityStatuses.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label><label>Information source URL<input type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} /></label></div><label>Administrator notes<textarea value={notes} onChange={(event) => setNotes(event.target.value)} /></label><button disabled={busy}>Save campsite details</button>{message && <p role="status">{message}</p>}</form></div></section>;
}

function ClubSettingsForm({ calendar, api, onRefresh }: { calendar: Calendar; api: TripApi; onRefresh: () => Promise<void> }) {
  const config = calendar.clubConfiguration;
  const [timezone, setTimezone] = useState(config.timezone ?? "");
  const [leadDays, setLeadDays] = useState(config.defaultPollLeadDays);
  const [closeTime, setCloseTime] = useState(config.defaultPollCloseTime?.slice(0, 5) ?? "");
  const [minimum, setMinimum] = useState(config.defaultMinimumParticipants);
  const [rotationStart, setRotationStart] = useState(config.nextRotationPosition);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setTimezone(config.timezone ?? ""); setLeadDays(config.defaultPollLeadDays);
    setCloseTime(config.defaultPollCloseTime?.slice(0, 5) ?? ""); setMinimum(config.defaultMinimumParticipants);
    setRotationStart(config.nextRotationPosition);
  }, [config]);

  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage(null);
    try {
      await api("admin_configure_club", {
        timezone: timezone.trim(), leadDays: Number(leadDays), closeTime: closeTime ? `${closeTime}:00` : null,
        defaultMinimumParticipants: Number(minimum), nextRotationPosition: Number(rotationStart), expectedVersion: config.version,
      });
      await onRefresh(); setMessage("Club schedule defaults saved. The minimum count is stored for planning only.");
    } catch { setMessage("Could not save schedule defaults. Check the IANA timezone name and refresh before retrying."); }
    finally { setBusy(false); }
  }

  return <div className="card"><p className="eyebrow">Club-wide settings</p><h2>Club schedule defaults</h2><p>Choose the club’s time zone and default registration window. The minimum count does not trigger confirmation or cancellation.</p><form className="admin-form" onSubmit={(event) => void save(event)}><div className="form-grid"><label>Club timezone<input required value={timezone} onChange={(event) => setTimezone(event.target.value)} placeholder="America/Los_Angeles" /><small>Use an IANA name such as America/Los_Angeles.</small></label><label>Registration deadline lead (days)<input type="number" min="1" max="120" required value={leadDays} onChange={(event) => setLeadDays(Number(event.target.value))} /></label><label>Default deadline time<input type="time" value={closeTime} onChange={(event) => setCloseTime(event.target.value)} /><small>If blank, an administrator sets each poll’s deadline time.</small></label><label>Default minimum participation<input type="number" min="1" max="100" required value={minimum} onChange={(event) => setMinimum(Number(event.target.value))} /></label><label>Next rotation position<input type="number" min="1" max={calendar.campsites.length} required value={rotationStart} onChange={(event) => setRotationStart(Number(event.target.value))} /></label></div><button disabled={busy}>{busy ? "Saving…" : "Save club schedule defaults"}</button>{message && <p role="status">{message}</p>}</form></div>;
}

function PollManager({ calendar, api, onRefresh }: { calendar: Calendar; api: TripApi; onRefresh: () => Promise<void> }) {
  const [selectedId, setSelectedId] = useState(calendar.trips[0]?.tripId ?? "");
  const trip = calendar.trips.find((row) => row.tripId === selectedId) ?? calendar.trips[0];
  const deadlineLocal = formatZonedDateTimeLocal(trip?.pollDeadlineAt ?? null, trip?.clubTimezone ?? calendar.clubConfiguration.timezone);
  const [deadline, setDeadline] = useState(deadlineLocal.slice(0, 10));
  const [deadlineTime, setDeadlineTime] = useState(deadlineLocal.slice(11, 16) || calendar.clubConfiguration.defaultPollCloseTime?.slice(0, 5) || "18:00");
  const [startsOn, setStartsOn] = useState(trip?.startsOn ?? "");
  const [endsOn, setEndsOn] = useState(trip?.endsOn ?? "");
  const [minimum, setMinimum] = useState(trip?.minimumParticipants ?? calendar.clubConfiguration.defaultMinimumParticipants);
  const [capacity, setCapacity] = useState(trip?.maxCapacity?.toString() ?? "");
  const [siteId, setSiteId] = useState(trip?.selectedCampsiteId ?? "");
  const [bookingStatus, setBookingStatus] = useState<CabinBookingStatus | "">(trip?.cabinBookingStatus ?? "");
  const [information, setInformation] = useState(trip?.additionalInformation ?? "");
  const [pollMessage, setPollMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastMinuteMember, setLastMinuteMember] = useState("");
  const [lastMinuteResponse, setLastMinuteResponse] = useState<"coming" | "not_coming">("coming");

  useEffect(() => {
    if (!trip) return;
    const localDeadline = formatZonedDateTimeLocal(trip.pollDeadlineAt, trip.clubTimezone ?? calendar.clubConfiguration.timezone);
    setStartsOn(trip.startsOn ?? ""); setEndsOn(trip.endsOn ?? ""); setDeadline(localDeadline.slice(0, 10));
    setDeadlineTime(localDeadline.slice(11, 16) || calendar.clubConfiguration.defaultPollCloseTime?.slice(0, 5) || "18:00");
    setMinimum(trip.minimumParticipants); setCapacity(trip.maxCapacity?.toString() ?? ""); setSiteId(trip.selectedCampsiteId);
    setBookingStatus(trip.cabinBookingStatus ?? ""); setInformation(trip.additionalInformation);
  }, [calendar, selectedId, trip]);

  async function configurePoll(event: React.FormEvent) {
    event.preventDefault(); if (!trip) return;
    if (!bookingStatus) { setPollMessage("Select a Cabin Booking Status before saving this poll."); return; }
    if (!trip.clubTimezone && !calendar.clubConfiguration.timezone) { setPollMessage("Set the club timezone in Club-wide settings before saving this poll."); return; }
    setBusy(true); setPollMessage(null);
    try {
      const effectiveDeadline = deadline || (startsOn ? datePlusDays(startsOn, -calendar.clubConfiguration.defaultPollLeadDays) : "");
      await api("admin_configure_trip", {
        tripId: trip.tripId, startsOn, endsOn, deadlineDate: effectiveDeadline || null,
        deadlineTime: deadlineTime || null, minimumParticipants: Number(minimum), maxCapacity: capacity ? Number(capacity) : null,
        selectedCampsiteId: siteId, cabinBookingStatus: bookingStatus, additionalInformation: information,
        expectedVersion: trip.version, reason: "Interest poll configuration",
      });
      await onRefresh(); setPollMessage("Poll configuration saved.");
    } catch (error) { setPollMessage(error instanceof TripApiError && error.status === 409 ? "This poll changed while you were editing. Refresh the calendar and try again." : "Could not save poll details. Check the dates, timezone, and selected status, then try again."); }
    finally { setBusy(false); }
  }

  async function setPollStatus(pollStatus: "open" | "closed") {
    if (!trip) return;
    if (pollStatus === "open" && !trip.clubTimezone && !calendar.clubConfiguration.timezone) { setPollMessage("Set the club timezone in Club-wide settings before opening this poll."); return; }
    setBusy(true); setPollMessage(null);
    try { await api("admin_set_poll_status", { tripId: trip.tripId, pollStatus, expectedVersion: trip.version, reason: `Administrator ${pollStatus} interest poll` }); await onRefresh(); setPollMessage(`Interest poll ${pollStatus}. No trip decision was made.`); }
    catch { setPollMessage("Could not change the poll. Confirm it has dates, a future deadline, and an applicable rule bundle."); }
    finally { setBusy(false); }
  }

  async function extendCalendar() {
    setBusy(true); setPollMessage(null);
    try { const month = new Date(); month.setUTCDate(1); month.setUTCMonth(month.getUTCMonth() + 12); await api("admin_generate_calendar", { throughMonth: month.toISOString().slice(0, 7) }); await onRefresh(); setPollMessage("Calendar horizon replenished."); }
    catch { setPollMessage("Could not extend the rolling calendar."); }
    finally { setBusy(false); }
  }

  async function addLastMinuteEntry() {
    if (!trip || !lastMinuteMember) return;
    const existing = trip.participantEntries?.find((entry) => entry.memberId === lastMinuteMember);
    setBusy(true); setPollMessage(null);
    try {
      await api("admin_record_interest", {
        tripId: trip.tripId, memberId: lastMinuteMember, response: lastMinuteResponse,
        expectedVersion: existing?.version ?? 0, reason: "Administrator recorded a late interest response",
      });
      await onRefresh(); setPollMessage("Late interest response recorded.");
    } catch {
      setPollMessage(lastMinuteResponse === "coming"
        ? "Could not record Coming. The member must first acknowledge the current Camping Constitution in their account, and the poll must still be open."
        : "Could not record this response. The poll may be closed or another edit may have changed it.");
    } finally { setBusy(false); }
  }

  return <section className="stack"><ClubSettingsForm calendar={calendar} api={api} onRefresh={onRefresh} /><div className="card"><p className="eyebrow">Rolling 12-month calendar</p><h2>Monthly interest polls</h2><p>Configure trip dates, registration deadline, campsite, and minimum interest count. The minimum count is stored for planning only until the owner approves how it is evaluated. Opening or closing a poll never confirms or cancels a trip.</p><label>Select month<select value={trip?.tripId ?? ""} onChange={(event) => setSelectedId(event.target.value)}>{calendar.trips.map((row) => <option value={row.tripId} key={row.tripId}>{monthName(row.monthKey)} · {calendar.campsites.find((site) => site.campsiteId === row.selectedCampsiteId)?.name}</option>)}</select></label>{trip && <form className="admin-form" onSubmit={(event) => void configurePoll(event)}><div className="form-grid"><label>Trip start<input type="date" required value={startsOn} onChange={(event) => setStartsOn(event.target.value)} /></label><label>Trip end<input type="date" required value={endsOn} onChange={(event) => setEndsOn(event.target.value)} /></label><label>Registration deadline date<input type="date" required value={deadline || (startsOn ? datePlusDays(startsOn, -calendar.clubConfiguration.defaultPollLeadDays) : "")} onChange={(event) => setDeadline(event.target.value)} /></label><label>Deadline time in {trip.clubTimezone ?? calendar.clubConfiguration.timezone ?? "club timezone"}<input type="time" required value={deadlineTime} onChange={(event) => setDeadlineTime(event.target.value)} /></label><label>Minimum participation count<input type="number" min="1" max="100" required value={minimum} onChange={(event) => setMinimum(Number(event.target.value))} /></label><label>Optional capacity<input type="number" min="1" value={capacity} onChange={(event) => setCapacity(event.target.value)} /></label></div><label>Selected campsite<select value={siteId} onChange={(event) => setSiteId(event.target.value)}>{calendar.campsites.map((site) => <option key={site.campsiteId} value={site.campsiteId}>{site.name}{site.campsiteId === trip.suggestedCampsiteId ? " · round-robin suggestion" : ""}</option>)}</select></label><label>Cabin Booking Status<select required value={bookingStatus} onChange={(event) => setBookingStatus(event.target.value as CabinBookingStatus | "")}><option value="" disabled>Select a status</option>{cabinBookingStatuses.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}</select></label>{!bookingStatus && trip.legacyCabinAvailabilityStatus && <p role="note">Previous availability value: {trip.legacyCabinAvailabilityStatus.replaceAll("_", " ")}. Choose a booking status; this older value was not converted automatically.</p>}<label>Trip information<textarea value={information} onChange={(event) => setInformation(event.target.value)} /></label><button disabled={busy}>Save poll details</button></form>}
      {trip && <div className="poll-actions"><span className={`status-chip status-${trip.pollStatus}`}>{trip.pollStatus}</span>{trip.pollStatus === "open" ? <button type="button" className="secondary-button" disabled={busy} onClick={() => void setPollStatus("closed")}>Close poll</button> : <button type="button" disabled={busy} onClick={() => void setPollStatus("open")}>Open poll</button>}<span>{trip.comingCount} Coming responses</span></div>}
      {trip && trip.pollStatus === "open" && <section className="late-entry"><h3>Record a late interest response</h3><p>For Coming, the member must have personally acknowledged the current rule bundle first.</p><div className="form-grid"><label>Member<select value={lastMinuteMember} onChange={(event) => setLastMinuteMember(event.target.value)}><option value="">Choose member</option>{(calendar.members ?? []).map((member) => <option key={member.memberId} value={member.memberId}>{member.displayName}</option>)}</select></label><label>Response<select value={lastMinuteResponse} onChange={(event) => setLastMinuteResponse(event.target.value as "coming" | "not_coming")}><option value="coming">Coming</option><option value="not_coming">Not Coming</option></select></label></div><button type="button" disabled={busy || !lastMinuteMember} onClick={() => void addLastMinuteEntry()}>Save late response</button>{(trip.participantEntries?.length ?? 0) > 0 && <ul className="admin-participant-list">{trip.participantEntries?.map((entry) => <li key={entry.memberId}>{entry.displayName} <strong>{entry.response === "coming" ? "Coming" : "Not Coming"}</strong></li>)}</ul>}</section>}
      {(calendar.withdrawalRequests ?? []).filter((request) => request.tripId === trip?.tripId).length > 0 && <section className="late-entry"><h3>Pending withdrawal requests</h3><p>Requests remain pending and do not alter a Coming response while the owner policy is unresolved.</p><ul>{(calendar.withdrawalRequests ?? []).filter((request) => request.tripId === trip?.tripId).map((request) => <li key={request.requestId}><strong>{request.displayName}</strong> · {new Date(request.createdAt).toLocaleString()}<p>{request.reason}</p></li>)}</ul></section>}
      <button type="button" className="secondary-button" disabled={busy} onClick={() => void extendCalendar()}>Generate rolling calendar through 12 months ahead</button>{pollMessage && <p role="status">{pollMessage}</p>}</div></section>;
}

function ConstitutionManager({ calendar, api, onRefresh }: { calendar: Calendar; api: TripApi; onRefresh: () => Promise<void> }) {
  const [scope, setScope] = useState<"general" | "trip">("general");
  const [tripId, setTripId] = useState(calendar.trips[0]?.tripId ?? "");
  const [key, setKey] = useState(""); const [category, setCategory] = useState<(typeof categories)[number]>("custom");
  const [text, setText] = useState(""); const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 16));
  const [expiresAt, setExpiresAt] = useState(""); const [reason, setReason] = useState("");
  const [baseVersionId, setBaseVersionId] = useState(""); const [overrideText, setOverrideText] = useState("");
  const [overrideExpiresAt, setOverrideExpiresAt] = useState(""); const [overrideReason, setOverrideReason] = useState("");
  const [rulesData, setRulesData] = useState<Record<string, unknown> | null>(null);
  const [message, setMessage] = useState<string | null>(null); const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void api<Record<string, unknown>>("get_constitution", scope === "trip" ? { tripId } : {}).then((data) => { if (live) setRulesData(data); }).catch(() => { if (live) setRulesData(null); });
    return () => { live = false; };
  }, [api, scope, tripId]);

  async function publish(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage(null);
    try {
      await api("admin_publish_rule", {
        scope, tripId: scope === "trip" ? tripId : null, stableKey: key.trim().toLowerCase().replaceAll(" ", "-"),
        category, text, structuredValues: {}, effectiveFrom: new Date(effectiveFrom).toISOString(),
        expiresAt: scope === "trip" ? (expiresAt ? new Date(expiresAt).toISOString() : null) : (expiresAt ? new Date(expiresAt).toISOString() : null),
        reason,
      });
      await onRefresh(); setMessage("A new immutable rule version has been published."); setText(""); setReason("");
      const result = await api<Record<string, unknown>>("get_constitution", scope === "trip" ? { tripId } : {}); setRulesData(result);
    } catch { setMessage("Could not publish this rule. Trip-specific rules require an expiry later than now."); }
    finally { setBusy(false); }
  }

  async function publishOverride(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage(null);
    try {
      await api("admin_set_rule_override", {
        tripId, baseRuleVersionId: baseVersionId, text: overrideText, structuredValues: {},
        expiresAt: new Date(overrideExpiresAt).toISOString(), reason: overrideReason,
      });
      const result = await api<Record<string, unknown>>("get_constitution", { tripId });
      setRulesData(result); setMessage("A new expiring trip override was recorded as an immutable version.");
      setOverrideText(""); setOverrideReason(""); setOverrideExpiresAt(""); await onRefresh();
    } catch { setMessage("Could not publish this override. Choose the current general rule version and an expiry in the future."); }
    finally { setBusy(false); }
  }

  const definitions = (rulesData?.definitions as Array<{ id: string; stable_key: string; category: string; scope: string }>) ?? [];
  const versions = (rulesData?.versions as Array<{ id: string; definition_id: string; version_no: number; human_text: string; effective_from: string; expires_at: string | null }>) ?? [];
  const latestGeneralVersions = definitions.filter((definition) => definition.scope === "general").flatMap((definition) => {
    const current = versions.filter((version) => version.definition_id === definition.id && new Date(version.effective_from).getTime() <= Date.now() && (!version.expires_at || new Date(version.expires_at).getTime() > Date.now())).sort((left, right) => right.effective_from.localeCompare(left.effective_from) || right.version_no - left.version_no)[0];
    return current ? [{ ...current, stable_key: definition.stable_key }] : [];
  });
  const overrides = (rulesData?.overrides as Array<{ id: string; base_rule_version_id: string; version_no: number; human_text: string; expires_at: string; retired_at: string | null }>) ?? [];

  return <section className="stack"><div className="card"><p className="eyebrow">Camping Constitution</p><h2>Publish a rule version</h2><p>Rule versions and each member’s acknowledgment are preserved. A later version does not rewrite an earlier acknowledgment.</p><form className="admin-form" onSubmit={(event) => void publish(event)}><div className="form-grid"><label>Applies to<select value={scope} onChange={(event) => setScope(event.target.value as "general" | "trip")}><option value="general">All trips</option><option value="trip">Specific trip</option></select></label>{scope === "trip" && <label>Trip<select value={tripId} onChange={(event) => setTripId(event.target.value)}>{calendar.trips.map((trip) => <option key={trip.tripId} value={trip.tripId}>{monthName(trip.monthKey)}</option>)}</select></label>}<label>Rule key<input required pattern="[a-zA-Z0-9 _-]+" value={key} onChange={(event) => setKey(event.target.value)} placeholder="quiet-hours" /></label><label>Category<select value={category} onChange={(event) => setCategory(event.target.value as (typeof categories)[number])}>{categories.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label>Effective from<input required type="datetime-local" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} /></label><label>Expires at {scope === "trip" ? "(required)" : "(optional)"}<input required={scope === "trip"} type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label></div><label>Rule text<textarea required minLength={1} maxLength={8000} value={text} onChange={(event) => setText(event.target.value)} /></label><label>Reason for this version<input required maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label><button disabled={busy}>{busy ? "Publishing…" : "Publish immutable version"}</button></form>{message && <p role="status">{message}</p>}</div>
    {scope === "trip" && <div className="card"><p className="eyebrow">Rule override</p><h2>Override a general rule for this trip</h2><p>An override must reference the current general rule version and expires independently. It does not alter the general rule or earlier acknowledgments.</p><form className="admin-form" onSubmit={(event) => void publishOverride(event)}><label>General rule to override<select required value={baseVersionId} onChange={(event) => setBaseVersionId(event.target.value)}><option value="">Choose current general rule</option>{latestGeneralVersions.map((version) => <option key={version.id} value={version.id}>{version.stable_key} · version {version.version_no}</option>)}</select></label><label>Trip-specific text<textarea required maxLength={8000} value={overrideText} onChange={(event) => setOverrideText(event.target.value)} /></label><div className="form-grid"><label>Override expires at<input type="datetime-local" required value={overrideExpiresAt} onChange={(event) => setOverrideExpiresAt(event.target.value)} /></label><label>Reason<input required maxLength={500} value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} /></label></div><button disabled={busy || latestGeneralVersions.length === 0}>{busy ? "Saving…" : "Publish expiring override"}</button></form><h3>Override history</h3>{overrides.length === 0 ? <p>No trip overrides yet.</p> : <ul>{overrides.map((override) => <li key={override.id}>Version {override.version_no} · expires {new Date(override.expires_at).toLocaleString()} · {override.retired_at ? "retired" : "active"}<p>{override.human_text}</p></li>)}</ul>}{message && <p role="status">{message}</p>}</div>}
    <div className="card"><h2>Rule history</h2>{definitions.length === 0 ? <p>Loading rule history…</p> : definitions.map((definition) => <details key={definition.id} className="rule-history"><summary>{definition.stable_key} <span>({definition.scope}, {definition.category})</span></summary><ol>{versions.filter((version) => version.definition_id === definition.id).map((version) => <li key={version.id}><strong>Version {version.version_no}</strong> · effective {new Date(version.effective_from).toLocaleString()} · {version.expires_at ? `expires ${new Date(version.expires_at).toLocaleString()}` : "no expiry"}<p>{version.human_text}</p></li>)}</ol></details>)}</div></section>;
}

export function TripCalendarPage({ isAdmin, api = defaultApi }: Props) {
  const [calendar, setCalendar] = useState<Calendar | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>(isAdmin ? "calendar" : "calendar");

  async function refresh() {
    setError(null);
    try { setCalendar(await api<Calendar>("get_calendar")); }
    catch { setError("The trip calendar could not be loaded. Please try again."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);

  return <section className="trip-page"><div className="page-heading"><p className="eyebrow">Private club planning</p><h1>Camping calendar</h1><p>Monthly interest polls, campsite rotation, and the Camping Constitution.</p></div>
    {isAdmin && <div className="admin-tabs" role="tablist" aria-label="Trip administration"><button role="tab" aria-selected={tab === "calendar"} onClick={() => setTab("calendar")}>Polls &amp; calendar</button><button role="tab" aria-selected={tab === "campsites"} onClick={() => setTab("campsites")}>Campsites</button><button role="tab" aria-selected={tab === "constitution"} onClick={() => setTab("constitution")}>Constitution</button></div>}
    {loading && <p role="status">Loading camping calendar…</p>}{error && <div className="card"><ErrorText value={error} /><button className="secondary-button" onClick={() => void refresh()}>Try again</button></div>}
    {calendar && (!isAdmin || tab === "calendar") && <div className="stack">{isAdmin && <PollManager calendar={calendar} api={api} onRefresh={refresh} />}{calendar.trips.map((trip) => <TripPollCard key={trip.tripId} trip={trip} api={api} onRefresh={refresh} />)}</div>}
    {calendar && isAdmin && tab === "campsites" && <CampsiteManager calendar={calendar} api={api} onRefresh={refresh} />}
    {calendar && isAdmin && tab === "constitution" && <ConstitutionManager calendar={calendar} api={api} onRefresh={refresh} />}
  </section>;
}
