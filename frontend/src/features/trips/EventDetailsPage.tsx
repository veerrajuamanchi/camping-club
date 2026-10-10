import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { invokeTripApi } from "../../lib/supabase";

type TripDetails = {
  tripId: string;
  monthKey: string;
  pollStatus: "draft" | "open" | "closed";
  startsOn: string | null;
  endsOn: string | null;
  additionalInformation: string;
  comingCount: number;
  effectiveCapacity: number | null;
  spotsRemaining: number | null;
  waitlistCount: number;
  myWaitlistPosition: number | null;
  myRsvp: null | { response: "coming" | "not_coming"; version: number; acknowledgmentId: string | null; updatedAt: string; acceptedRuleBundle?: { version: number } | null };
  currentRuleBundle: null | { id: string; version: number; contentHash: string; rules: Array<{ stable_key: string; text: string; category?: string; structured_values: Record<string, unknown> }>; createdAt: string };
  campsite: null | { campsiteId: string; name: string; locationDescription: string; availabilityUrl: string | null; directions: string | null; cabinCapacity: number | null; reservationInstructions: string | null };
  perCabinCapacity: number;
  cabinCount: number | null;
  maxCapacity: number | null;
  participantEntries: Array<{ memberId: string; displayName: string; response: string }>;
  waitlistEntries: Array<{ memberId: string; displayName: string; position: number; createdAt: string }>;
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
  const [categoryMap, setCategoryMap] = useState<Record<string, string>>({});

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
      await api("submit_rsvp", {
        tripId: details.tripId,
        response: rsvpChoice,
        expectedVersion: details.myRsvp?.version ?? 0,
        ...(rsvpChoice === "coming" && details.currentRuleBundle
          ? { bundleId: details.currentRuleBundle.id, contentHash: details.currentRuleBundle.contentHash }
          : {}),
      });
      setRsvpChoice(null);
      setAcknowledged(false);
      await refresh();
    } catch {
      setRsvpError("Response could not be saved. Refresh and try again.");
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
  const rsvpStatusLabel = details.myWaitlistPosition
    ? "Waitlisted"
    : details.myRsvp?.response === "coming"
      ? "Going"
      : details.myRsvp?.response === "not_coming"
        ? "Not Going"
        : "No response";

  const groupedRules = constitutionGroups.map((group) => ({
    ...group,
    rules: (details.currentRuleBundle?.rules ?? []).filter((r) => {
      const cat = (r as { category?: string }).category ?? categoryMap[r.stable_key] ?? "custom";
      return group.categories.includes(cat);
    }),
  }));

  return (
    <section className="event-details">
      <div className="page-heading">
        <p className="eyebrow">{details.monthKey}</p>
        <h1>{details.additionalInformation || "Camping Trip"}</h1>
        {!isDraft && details.startsOn && (
          <p>
            {details.startsOn} – {details.endsOn}
          </p>
        )}
        {isDraft && <p className="eyebrow">Dates TBA</p>}
      </div>

      <div className="event-tabs" role="tablist" aria-label="Trip sections">
        {(["overview", "constitution", "logistics", "financials"] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="stack">
          {details.campsite && (
            <div className="card">
              <h2>Campsite</h2>
              <p>
                <strong>{details.campsite.name}</strong>
              </p>
              {details.campsite.locationDescription && <p>{details.campsite.locationDescription}</p>}
              {details.campsite.availabilityUrl && (
                <a href={details.campsite.availabilityUrl} target="_blank" rel="noopener noreferrer">
                  View campsite
                </a>
              )}
            </div>
          )}

          <div className="card">
            <h2>Attendance</h2>
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

            {rsvpError && (
              <p role="alert" className="form-error">
                {rsvpError}
              </p>
            )}

            {details.participantEntries.length > 0 && (
              <details>
                <summary>{details.comingCount} Going</summary>
                <ul>
                  {details.participantEntries.map((e) => (
                    <li key={e.memberId}>{e.displayName}</li>
                  ))}
                </ul>
              </details>
            )}

            {isAdmin && details.waitlistEntries.length > 0 && (
              <details>
                <summary>Waitlist ({details.waitlistEntries.length})</summary>
                <ol>
                  {details.waitlistEntries.map((w) => (
                    <li key={w.memberId}>
                      {w.displayName} · joined {new Date(w.createdAt).toLocaleDateString()}
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
          <h2>Logistics</h2>
          {details.additionalInformation ? (
            <p>{details.additionalInformation}</p>
          ) : (
            <p>Logistics details will be added by the administrator.</p>
          )}
          {details.campsite?.reservationInstructions && (
            <>
              <h3>Reservation instructions</h3>
              <p>{details.campsite.reservationInstructions}</p>
            </>
          )}
          {details.campsite?.directions && (
            <>
              <h3>Directions</h3>
              <p>{details.campsite.directions}</p>
            </>
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
    </section>
  );
}
