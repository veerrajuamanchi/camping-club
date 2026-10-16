import { useState } from "react";
import type { MasterResponsibility, TripTimeSlot } from "./AdminTimeSlotManagerModal";
import type { TripApiType } from "./EventDetailsPage";

export function eventDates(start: string | null, end: string | null): string[] {
  if (!start || !end || start > end) return [];
  const dates: string[] = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cursor <= last) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

type Props = {
  tripId: string; start: string | null; end: string | null; tripVersion: number;
  slots: TripTimeSlot[]; responsibilities: MasterResponsibility[]; assignedDutyIds: string[];
  api: TripApiType; onSaved: () => Promise<void>;
};

export function DailyResponsibilityPlanner({ tripId, start, end, tripVersion, slots, responsibilities, assignedDutyIds, api, onSaved }: Props) {
  const dates = eventDates(start, end);
  const existing = slots.filter(slot => slot.is_enabled).flatMap(slot => (slot.duties ?? []).filter(duty => duty.is_active).map(duty => ({ ...duty, date: slot.slot_date })));
  const choices = [...responsibilities];
  for (const duty of existing) if (duty.responsibility && !choices.some(item => item.id === duty.master_responsibility_id)) choices.push(duty.responsibility);
  const [selected, setSelected] = useState<Record<string, string[]>>(() => Object.fromEntries(dates.map(date => [date, [...new Set(existing.filter(duty => duty.date === date).map(duty => duty.master_responsibility_id))]])));
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmRemoval, setConfirmRemoval] = useState(false);
  const removedClaim = existing.some(duty => assignedDutyIds.includes(duty.id) && !selected[duty.date]?.includes(duty.master_responsibility_id));

  async function save(confirmed = false) {
    setError(null); setSuccess(false);
    if (dates.length === 0 || dates.some(date => !selected[date]?.length)) {
      setError("Choose at least one responsibility for every date."); return;
    }
    if (removedClaim && !confirmed) { setConfirmRemoval(true); return; }
    setBusy(true);
    try {
      await api("admin_save_daily_responsibilities", { tripId, expectedVersion: tripVersion, confirmRemoval: confirmed,
        days: dates.map(date => ({ date, responsibilityIds: selected[date] })) });
      setConfirmRemoval(false); setSuccess(true);
      await onSaved();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not save daily responsibilities.";
      if (message.includes("confirmation_required")) setConfirmRemoval(true);
      else setError(message.includes("stale") ? "This event changed. Close and reopen the planner before saving." : message);
    } finally { setBusy(false); }
  }

  return <section className="card" aria-label="Daily responsibility planner">
    <h3>Responsibilities for each event date</h3>
    <p>Choose at least one master responsibility for every date, then save the whole plan. New duties use the master's weight and volunteer capacity.</p>
    {!dates.length && <p role="alert">Set the event start and end dates before choosing responsibilities.</p>}
    {!choices.length && <p role="alert">Add active tasks in Master Responsibilities before planning this event.</p>}
    <div className="stack">
      {dates.map(date => {
        const chosen = selected[date] ?? [];
        let weightTenths = 0; let capacityTenths = 0;
        for (const id of chosen) {
          const duties = existing.filter(duty => duty.date === date && duty.master_responsibility_id === id);
          const master = choices.find(item => item.id === id);
          for (const item of duties.length ? duties : master ? [{ workload_weight: master.workload_weight, capacity: master.default_capacity }] : []) {
            weightTenths += Math.round(Number(item.workload_weight) * 10);
            capacityTenths += Math.round(Number(item.workload_weight) * 10) * item.capacity;
          }
        }
        return <fieldset key={date} style={{ minWidth: 0, border: "1px solid #cbd5e1", borderRadius: "8px", padding: "0.75rem" }}>
          <legend>{new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })} · {date}</legend>
          {choices.map(item => <label key={item.id} style={{ display: "flex", alignItems: "center", gap: "0.75rem", minHeight: "44px", overflowWrap: "anywhere" }}>
            <input type="checkbox" checked={chosen.includes(item.id)} disabled={busy || (!item.active && !existing.some(duty => duty.date === date && duty.master_responsibility_id === item.id))}
              style={{ width: "20px", height: "20px", flex: "0 0 20px", margin: 0 }}
              onChange={event => { setSuccess(false); setSelected(current => ({ ...current, [date]: event.target.checked ? [...(current[date] ?? []), item.id] : (current[date] ?? []).filter(id => id !== item.id) })); }} />
            <span>{item.title}{!item.active ? " (retired; existing selection)" : ""} · {Number(item.workload_weight)}× · {item.default_capacity} volunteer slots</span>
          </label>)}
          <p>Selected task weight: {weightTenths / 10}× · Volunteer capacity: {capacityTenths / 10}×</p>
        </fieldset>;
      })}
    </div>
    {error && <p role="alert">{error}</p>}
    {success && <p role="status">Daily responsibilities saved.</p>}
    <button type="button" disabled={busy || !dates.length || !choices.length} style={{ minHeight: "44px", marginTop: "1rem" }} onClick={() => void save()}>{busy ? "Saving…" : "Save daily responsibilities"}</button>
    {confirmRemoval && <div role="dialog" aria-modal="true" aria-label="Confirm responsibility removal" className="card" style={{ border: "2px solid #b45309", marginTop: "1rem" }}>
      <h4>Remove responsibilities with volunteers?</h4>
      <p>Volunteers have assignments on removed tasks. Those duties will stop counting toward workload. Assignment history is retained. Selected duties keep their existing assignments.</p>
      <button type="button" disabled={busy} style={{ minHeight: "44px" }} onClick={() => void save(true)}>Confirm removal and save</button>{" "}
      <button type="button" disabled={busy} style={{ minHeight: "44px" }} onClick={() => setConfirmRemoval(false)}>Keep editing</button>
    </div>}
  </section>;
}
