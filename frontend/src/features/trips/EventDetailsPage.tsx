import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { invokeTripApi, TripApiError } from "../../lib/supabase";

type TripDetails = {
  tripId: string;
  monthKey: string;
  pollStatus: "draft" | "open" | "closed";
  startsOn: string | null;
  endsOn: string | null;
  pollDeadlineAt?: string | null;
  minimumParticipants?: number;
  selectedCampsiteId?: string;
  cabinBookingStatus?: "booked" | "no_vacancy" | "sites_available" | null;
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

type Tab = "overview" | "constitution" | "logistics" | "financials";
type TripApiType = <T = unknown>(action: string, input?: unknown) => Promise<T>;

const constitutionGroups: Array<{ label: string; categories: string[] }> = [
  { label: "Travel & Cabin", categories: ["transport", "cabin"] },
  { label: "Food & Expenses", categories: ["expenses", "conduct"] },
  { label: "Lodging & Responsibilities", categories: ["lodging", "participation"] },
  { label: "Packing & Meals", categories: ["meals", "custom"] },
];

function monthName(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1)));
}

type Props = { isAdmin: boolean; api?: TripApiType };
const defaultApi: TripApiType = (action, input) => invokeTripApi(action, input);

export function EventDetailsPage({ isAdmin, api = defaultApi }: Props) {
  const { tripId } = useParams<{ tripId: string }>();
  const [details, setDetails] = useState<TripDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("overview");
  const [rsvpChoice, setRsvpChoice] = useState<"coming" | "not_coming" | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [rsvpBusy, setRsvpBusy] = useState(false);
  const [rsvpError, setRsvpError] = useState<string | null>(null);
  const [waitlistedPosition, setWaitlistedPosition] = useState<number | null>(null);
  const [categoryMap, setCategoryMap] = useState<Record<string, string>>({});
  const [adminRosterMsg, setAdminRosterMsg] = useState<string | null>(null);
  const [showEditLogistics, setShowEditLogistics] = useState(false);

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
      setRsvpChoice(null);
      setAcknowledged(false);
      await refresh();
    } catch {
      setRsvpError("Response could not be saved. Refresh and try again.");
    } finally {
      setRsvpBusy(false);
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
  const isOpen = details.pollStatus === "open";
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

  const tripTitle = details.additionalInformation || `${monthName(details.monthKey)} Camping`;
  const campsiteLocation = details.campsite
    ? `${details.campsite.name}${details.campsite.locationDescription ? ` · ${details.campsite.locationDescription}` : ""}`
    : "TBA";

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
            <span className={`event-status-pill status-${isDraft ? "upcoming" : details.pollStatus}`}>
              {isDraft ? "Upcoming" : details.pollStatus}
            </span>
            {isComing && <span className="status-badge-going">You're going</span>}
            {isNotComing && <span className="status-badge-not-going">Not going</span>}
            {details.myWaitlistPosition && (
              <span className="status-badge-not-going">Waitlist #{details.myWaitlistPosition}</span>
            )}
          </div>
        </div>

        <div className="hero-info-list">
          {!isDraft && details.startsOn && details.endsOn ? (
            <div className="hero-info-item">
              <span>📅</span>
              <strong>{details.startsOn} – {details.endsOn}</strong>
            </div>
          ) : (
            <div className="hero-info-item">
              <span>📅</span>
              <strong>Dates TBA</strong>
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
              {details.cabinCount != null ? `${details.cabinCount} cabins · ` : ""}
              {details.perCabinCapacity} people per cabin
              {details.effectiveCapacity != null ? ` (${details.effectiveCapacity} total spots)` : ""}
            </span>
          </div>
          {details.minimumParticipants != null && (
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
          </div>
          <div className="metric-box-card">
            <p className="metric-value">{details.spotsRemaining ?? "—"}</p>
            <p className="metric-label">Spots left</p>
          </div>
          <div className="metric-box-card">
            <p className="metric-value">{details.waitlistCount}</p>
            <p className="metric-label">Waitlisted</p>
          </div>
        </div>
      </div>

      <div className="event-tabs" role="tablist" aria-label="Trip sections">
        {(["overview", "constitution", "logistics", "financials"] as Tab[]).map((t) => (
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
                    style={{ width: "100%", maxHeight: "280px", objectFit: "cover", borderRadius: "12px" }}
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
            <div className="event-card-meta">
              {details.cabinCount != null && <span>{details.cabinCount} cabins booked</span>}
              {details.effectiveCapacity != null && <span>Capacity: {details.effectiveCapacity}</span>}
              <span>{details.comingCount} confirmed</span>
              {details.spotsRemaining != null && <span>{details.spotsRemaining} spots remaining</span>}
              {details.waitlistCount > 0 && <span>{details.waitlistCount} on waitlist</span>}
            </div>
            <p>
              Your status: <strong>{rsvpStatusLabel}</strong>
            </p>

            {!isDraft && isOpen && (
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

      {showEditLogistics && details && (
        <EditLogisticsModal
          details={details}
          api={api}
          onClose={() => setShowEditLogistics(false)}
          onRefresh={refresh}
        />
      )}
    </section>
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

