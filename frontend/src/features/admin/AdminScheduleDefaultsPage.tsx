import { useEffect, useState } from "react";
import { Link } from "react-router";
import { invokeTripApi } from "../../lib/supabase";
import type { Calendar, TripApi } from "../trips/TripCalendarPage";

const defaultApi: TripApi = (action, input, key) => invokeTripApi(action, input, key);

export function AdminScheduleDefaultsPage({ api = defaultApi }: { api?: TripApi }) {
  const [calendar, setCalendar] = useState<Calendar | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [timezone, setTimezone] = useState("");
  const [leadDays, setLeadDays] = useState(35);
  const [closeTime, setCloseTime] = useState("18:00");
  const [minimum, setMinimum] = useState(4);
  const [rotationStart, setRotationStart] = useState(1);

  async function load() {
    setLoading(true);
    try {
      const data = await api<Calendar>("get_calendar");
      setCalendar(data);
      const config = data.clubConfiguration;
      setTimezone(config.timezone ?? "America/Los_Angeles");
      setLeadDays(config.defaultPollLeadDays);
      setCloseTime(config.defaultPollCloseTime?.slice(0, 5) ?? "18:00");
      setMinimum(config.defaultMinimumParticipants);
      setRotationStart(config.nextRotationPosition);
    } catch {
      setMessage("Could not load club configuration. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function saveDefaults(event: React.FormEvent) {
    event.preventDefault();
    if (!calendar) return;
    setBusy(true);
    setMessage(null);
    try {
      await api("admin_configure_club", {
        timezone: timezone.trim(),
        leadDays: Number(leadDays),
        closeTime: closeTime ? `${closeTime}:00` : null,
        defaultMinimumParticipants: Number(minimum),
        nextRotationPosition: Number(rotationStart),
        expectedVersion: calendar.clubConfiguration.version,
      });
      await load();
      setMessage("Club schedule defaults saved successfully.");
    } catch {
      setMessage("Could not save schedule defaults. Verify the IANA timezone (e.g. America/Los_Angeles).");
    } finally {
      setBusy(false);
    }
  }

  async function extendCalendar() {
    setBusy(true);
    setMessage(null);
    try {
      const month = new Date();
      month.setUTCDate(1);
      month.setUTCMonth(month.getUTCMonth() + 12);
      await api("admin_generate_calendar", { throughMonth: month.toISOString().slice(0, 7) });
      await load();
      setMessage("Rolling calendar horizon replenished through 12 months ahead.");
    } catch {
      setMessage("Could not extend the rolling calendar.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p role="status">Loading schedule defaults…</p>;

  return (
    <section className="stack">
      <Link to="/" className="back-link">
        &larr; All camping events
      </Link>

      <div className="card">
        <p className="eyebrow">Administration</p>
        <h2>Club Schedule Defaults</h2>
        <p>
          Configure the club’s time zone, default registration window, and minimum interest count.
        </p>

        <form className="admin-form" onSubmit={(e) => void saveDefaults(e)}>
          <div className="form-grid">
            <label>
              Club timezone
              <input
                required
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                placeholder="America/Los_Angeles"
              />
              <small>Use an IANA name such as America/Los_Angeles.</small>
            </label>
            <label>
              Registration deadline lead (days)
              <input
                type="number"
                min="1"
                max="120"
                required
                value={leadDays}
                onChange={(e) => setLeadDays(Number(e.target.value))}
              />
            </label>
            <label>
              Default deadline time
              <input
                type="time"
                value={closeTime}
                onChange={(e) => setCloseTime(e.target.value)}
              />
              <small>Default daily closing time for registration polls.</small>
            </label>
            <label>
              Default minimum participation
              <input
                type="number"
                min="1"
                max="100"
                required
                value={minimum}
                onChange={(e) => setMinimum(Number(e.target.value))}
              />
            </label>
            <label>
              Next rotation position
              <input
                type="number"
                min="1"
                max={Math.max(1, calendar?.campsites.length ?? 7)}
                required
                value={rotationStart}
                onChange={(e) => setRotationStart(Number(e.target.value))}
              />
            </label>
          </div>
          <button disabled={busy}>{busy ? "Saving…" : "Save schedule defaults"}</button>
        </form>

        <hr style={{ margin: "1.5rem 0" }} />

        <div>
          <h3>Calendar Horizon</h3>
          <p>
            Replenish the calendar forward so the club always has an upcoming 12-month schedule available.
          </p>
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => void extendCalendar()}
          >
            {busy ? "Extending…" : "Replenish calendar through 12 months ahead"}
          </button>
        </div>

        {message && <p role="status" style={{ marginTop: "1rem" }}>{message}</p>}
      </div>
    </section>
  );
}
