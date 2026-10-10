import { useEffect, useState } from "react";
import { Link } from "react-router";
import { invokeTripApi } from "../../lib/supabase";
import type { Calendar, TripApi } from "../trips/TripCalendarPage";

const defaultApi: TripApi = (action, input, key) => invokeTripApi(action, input, key);
const categories = ["participation", "transport", "cabin", "expenses", "lodging", "meals", "conduct", "custom"] as const;

function monthName(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, 1))
  );
}

export function AdminConstitutionPage({ api = defaultApi }: { api?: TripApi }) {
  const [calendar, setCalendar] = useState<Calendar | null>(null);
  const [scope, setScope] = useState<"general" | "trip">("general");
  const [tripId, setTripId] = useState("");
  const [key, setKey] = useState("");
  const [category, setCategory] = useState<(typeof categories)[number]>("custom");
  const [text, setText] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 16));
  const [expiresAt, setExpiresAt] = useState("");
  const [reason, setReason] = useState("");
  const [baseVersionId, setBaseVersionId] = useState("");
  const [overrideText, setOverrideText] = useState("");
  const [overrideExpiresAt, setOverrideExpiresAt] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [rulesData, setRulesData] = useState<Record<string, unknown> | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<Calendar>("get_calendar").then((data) => {
      setCalendar(data);
      if (data.trips[0]) setTripId(data.trips[0].tripId);
    });
  }, [api]);

  useEffect(() => {
    let live = true;
    void api<Record<string, unknown>>("get_constitution", scope === "trip" ? { tripId } : {})
      .then((data) => {
        if (live) setRulesData(data);
      })
      .catch(() => {
        if (live) setRulesData(null);
      });
    return () => {
      live = false;
    };
  }, [api, scope, tripId]);

  async function publish(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await api("admin_publish_rule", {
        scope,
        tripId: scope === "trip" ? tripId : null,
        stableKey: key.trim().toLowerCase().replaceAll(" ", "-"),
        category,
        text,
        structuredValues: {},
        effectiveFrom: new Date(effectiveFrom).toISOString(),
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        reason,
      });
      setMessage("A new immutable rule version has been published.");
      setText("");
      setReason("");
      const result = await api<Record<string, unknown>>("get_constitution", scope === "trip" ? { tripId } : {});
      setRulesData(result);
    } catch {
      setMessage("Could not publish this rule. Trip-specific rules require an expiry later than now.");
    } finally {
      setBusy(false);
    }
  }

  async function publishOverride(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await api("admin_set_rule_override", {
        tripId,
        baseRuleVersionId: baseVersionId,
        text: overrideText,
        structuredValues: {},
        expiresAt: new Date(overrideExpiresAt).toISOString(),
        reason: overrideReason,
      });
      const result = await api<Record<string, unknown>>("get_constitution", { tripId });
      setRulesData(result);
      setMessage("A new expiring trip override was recorded as an immutable version.");
      setOverrideText("");
      setOverrideReason("");
      setOverrideExpiresAt("");
    } catch {
      setMessage("Could not publish this override. Choose the current general rule version and an expiry in the future.");
    } finally {
      setBusy(false);
    }
  }

  const definitions = (rulesData?.definitions as Array<{ id: string; stable_key: string; category: string; scope: string }>) ?? [];
  const versions = (rulesData?.versions as Array<{ id: string; definition_id: string; version_no: number; human_text: string; effective_from: string; expires_at: string | null }>) ?? [];
  const latestGeneralVersions = definitions
    .filter((definition) => definition.scope === "general")
    .flatMap((definition) => {
      const current = versions
        .filter(
          (version) =>
            version.definition_id === definition.id &&
            new Date(version.effective_from).getTime() <= Date.now() &&
            (!version.expires_at || new Date(version.expires_at).getTime() > Date.now())
        )
        .sort(
          (left, right) =>
            right.effective_from.localeCompare(left.effective_from) || right.version_no - left.version_no
        )[0];
      return current ? [{ ...current, stable_key: definition.stable_key }] : [];
    });
  const overrides = (rulesData?.overrides as Array<{ id: string; base_rule_version_id: string; version_no: number; human_text: string; expires_at: string; retired_at: string | null }>) ?? [];

  return (
    <section className="stack">
      <Link to="/" className="back-link">
        &larr; All camping events
      </Link>

      <div className="card">
        <p className="eyebrow">Administration</p>
        <h2>Camping Constitution Manager</h2>
        <p>
          Publish and manage the club constitution rules. Rule versions and each member’s acknowledgment are
          immutable and preserved across changes.
        </p>

        <form className="admin-form" onSubmit={(event) => void publish(event)}>
          <div className="form-grid">
            <label>
              Applies to
              <select value={scope} onChange={(event) => setScope(event.target.value as "general" | "trip")}>
                <option value="general">All trips (General)</option>
                <option value="trip">Specific trip</option>
              </select>
            </label>
            {scope === "trip" && calendar && (
              <label>
                Trip
                <select value={tripId} onChange={(event) => setTripId(event.target.value)}>
                  {calendar.trips.map((trip) => (
                    <option key={trip.tripId} value={trip.tripId}>
                      {monthName(trip.monthKey)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Rule key
              <input
                required
                pattern="[a-zA-Z0-9 _-]+"
                value={key}
                onChange={(event) => setKey(event.target.value)}
                placeholder="quiet-hours"
              />
            </label>
            <label>
              Category
              <select value={category} onChange={(event) => setCategory(event.target.value as (typeof categories)[number])}>
                {categories.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Effective from
              <input
                required
                type="datetime-local"
                value={effectiveFrom}
                onChange={(event) => setEffectiveFrom(event.target.value)}
              />
            </label>
            <label>
              Expires at {scope === "trip" ? "(required)" : "(optional)"}
              <input
                required={scope === "trip"}
                type="datetime-local"
                value={expiresAt}
                onChange={(event) => setExpiresAt(event.target.value)}
              />
            </label>
          </div>
          <label>
            Rule text
            <textarea
              required
              minLength={1}
              maxLength={8000}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          <label>
            Reason for this version
            <input
              required
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <button disabled={busy}>{busy ? "Publishing…" : "Publish immutable rule version"}</button>
        </form>
        {message && <p role="status" style={{ marginTop: "1rem" }}>{message}</p>}
      </div>

      {scope === "trip" && (
        <div className="card">
          <p className="eyebrow">Trip Rule Override</p>
          <h2>Override a general rule for this trip</h2>
          <p>
            An override applies only to the selected trip and expires independently. It does not alter general rules.
          </p>
          <form className="admin-form" onSubmit={(event) => void publishOverride(event)}>
            <label>
              General rule to override
              <select required value={baseVersionId} onChange={(event) => setBaseVersionId(event.target.value)}>
                <option value="">Choose current general rule</option>
                {latestGeneralVersions.map((version) => (
                  <option key={version.id} value={version.id}>
                    {version.stable_key} · version {version.version_no}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Trip-specific text
              <textarea
                required
                maxLength={8000}
                value={overrideText}
                onChange={(event) => setOverrideText(event.target.value)}
              />
            </label>
            <div className="form-grid">
              <label>
                Override expires at
                <input
                  type="datetime-local"
                  required
                  value={overrideExpiresAt}
                  onChange={(event) => setOverrideExpiresAt(event.target.value)}
                />
              </label>
              <label>
                Reason
                <input
                  required
                  maxLength={500}
                  value={overrideReason}
                  onChange={(event) => setOverrideReason(event.target.value)}
                />
              </label>
            </div>
            <button disabled={busy || latestGeneralVersions.length === 0}>
              {busy ? "Saving…" : "Publish expiring override"}
            </button>
          </form>

          <h3>Override history</h3>
          {overrides.length === 0 ? (
            <p>No trip overrides recorded for this trip.</p>
          ) : (
            <ul>
              {overrides.map((override) => (
                <li key={override.id}>
                  Version {override.version_no} · expires {new Date(override.expires_at).toLocaleString()} ·{" "}
                  {override.retired_at ? "retired" : "active"}
                  <p>{override.human_text}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="card">
        <h2>Constitution Rule History</h2>
        {definitions.length === 0 ? (
          <p>Loading rule history…</p>
        ) : (
          definitions.map((definition) => (
            <details key={definition.id} className="rule-history">
              <summary>
                {definition.stable_key} <span>({definition.scope}, {definition.category})</span>
              </summary>
              <ol>
                {versions
                  .filter((version) => version.definition_id === definition.id)
                  .map((version) => (
                    <li key={version.id}>
                      <strong>Version {version.version_no}</strong> · effective{" "}
                      {new Date(version.effective_from).toLocaleString()} ·{" "}
                      {version.expires_at ? `expires ${new Date(version.expires_at).toLocaleString()}` : "no expiry"}
                      <p>{version.human_text}</p>
                    </li>
                  ))}
              </ol>
            </details>
          ))
        )}
      </div>
    </section>
  );
}
