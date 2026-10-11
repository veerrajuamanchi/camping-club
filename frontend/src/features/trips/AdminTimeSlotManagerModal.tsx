import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { TripApiType } from "./EventDetailsPage";

export type MasterResponsibility = {
  id: string;
  title: string;
  description: string | null;
  category: "meal_prep" | "cooking" | "cleanup" | "activities" | "transport" | "other";
  default_capacity: number;
  workload_weight: number;
  active: boolean;
};

export type TripSlotDuty = {
  id: string;
  time_slot_id: string;
  master_responsibility_id: string;
  capacity: number;
  workload_weight: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  responsibility?: MasterResponsibility;
};

export type TripTimeSlot = {
  id: string;
  trip_id: string;
  slot_date: string;
  time_block: string;
  slot_type: "meal" | "chore" | "activity" | "general";
  label: string;
  is_custom: boolean;
  is_enabled: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  duties?: TripSlotDuty[];
};

type Props = {
  tripId: string;
  tripStartsOn: string | null;
  tripEndsOn: string | null;
  api: TripApiType;
  onClose: () => void;
  onRefreshParent?: () => Promise<void>;
};

export function AdminTimeSlotManagerModal({
  tripId,
  tripStartsOn,
  tripEndsOn,
  api,
  onClose,
  onRefreshParent,
}: Props) {
  const [slots, setSlots] = useState<TripTimeSlot[]>([]);
  const [responsibilities, setResponsibilities] = useState<MasterResponsibility[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Custom slot form state
  const [showAddCustom, setShowAddCustom] = useState(false);
  const [customDate, setCustomDate] = useState(tripStartsOn ?? "");
  const [customTimeBlock, setCustomTimeBlock] = useState("afternoon");
  const [customSlotType, setCustomSlotType] = useState<"meal" | "chore" | "activity" | "general">("chore");
  const [customLabel, setCustomLabel] = useState("");

  // Add duty to slot state
  const [activeSlotForDuty, setActiveSlotForDuty] = useState<string | null>(null);
  const [selectedRespId, setSelectedRespId] = useState("");
  const [dutyCapacity, setDutyCapacity] = useState(2);
  const [dutyWeight, setDutyWeight] = useState(1.0);

  // Disable slot confirmation state
  const [confirmDisableSlot, setConfirmDisableSlot] = useState<TripTimeSlot | null>(null);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [slotsRes, respRes] = await Promise.all([
        api<{ timeSlots: TripTimeSlot[] }>("get_trip_time_slots", { tripId }),
        api<{ responsibilities: MasterResponsibility[] }>("admin_list_master_responsibilities", { includeInactive: false }),
      ]);
      setSlots(slotsRes.timeSlots ?? []);
      setResponsibilities(respRes.responsibilities ?? []);
      if (respRes.responsibilities && respRes.responsibilities.length > 0 && !selectedRespId) {
        setSelectedRespId(respRes.responsibilities[0].id);
        setDutyCapacity(respRes.responsibilities[0].default_capacity);
        setDutyWeight(respRes.responsibilities[0].workload_weight);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load time slots");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, [tripId]);

  function handleRespSelectChange(respId: string) {
    setSelectedRespId(respId);
    const found = responsibilities.find((r) => r.id === respId);
    if (found) {
      setDutyCapacity(found.default_capacity);
      setDutyWeight(found.workload_weight);
    }
  }

  async function handleGenerateSlots(regenerate = false) {
    setBusy(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await api("admin_generate_candidate_slots", { tripId, regenerate });
      setSuccessMsg(regenerate ? "Candidate slots regenerated." : "Standard candidate slots created.");
      await loadData();
      if (onRefreshParent) await onRefreshParent();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to generate candidate slots");
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleSlotEnabled(slot: TripTimeSlot) {
    if (slot.is_enabled) {
      // Disabling requires confirmation
      setConfirmDisableSlot(slot);
      return;
    }
    // Enabling directly
    setBusy(true);
    setError(null);
    try {
      await api("admin_configure_time_slot", { slotId: slot.id, isEnabled: true });
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to enable time slot");
    } finally {
      setBusy(false);
    }
  }

  async function executeDisableSlot() {
    if (!confirmDisableSlot) return;
    setBusy(true);
    setError(null);
    try {
      await api("admin_configure_time_slot", { slotId: confirmDisableSlot.id, isEnabled: false });
      setConfirmDisableSlot(null);
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to disable time slot");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateCustomSlot(e: FormEvent) {
    e.preventDefault();
    if (!customLabel.trim()) {
      setError("Please enter a slot label.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api("admin_create_custom_time_slot", {
        tripId,
        slotDate: customDate,
        timeBlock: customTimeBlock,
        slotType: customSlotType,
        label: customLabel.trim(),
      });
      setShowAddCustom(false);
      setCustomLabel("");
      setSuccessMsg("Custom slot created.");
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create custom slot");
    } finally {
      setBusy(false);
    }
  }

  async function handleAddDuty(e: FormEvent) {
    e.preventDefault();
    if (!activeSlotForDuty || !selectedRespId) return;
    setBusy(true);
    setError(null);
    try {
      await api("admin_add_slot_duty", {
        timeSlotId: activeSlotForDuty,
        masterResponsibilityId: selectedRespId,
        capacity: Number(dutyCapacity),
        workloadWeight: Number(dutyWeight),
      });
      setActiveSlotForDuty(null);
      setSuccessMsg("Duty added to slot.");
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to add duty");
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdateDutyCapacity(duty: TripSlotDuty, newCapacity: number) {
    if (newCapacity < 1 || newCapacity > 20) return;
    setBusy(true);
    setError(null);
    try {
      await api("admin_update_slot_duty", {
        slotDutyId: duty.id,
        capacity: newCapacity,
      });
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update duty capacity");
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleDutyActive(duty: TripSlotDuty) {
    setBusy(true);
    setError(null);
    try {
      await api("admin_update_slot_duty", {
        slotDutyId: duty.id,
        isActive: !duty.is_active,
      });
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to toggle duty status");
    } finally {
      setBusy(false);
    }
  }

  // Group slots by date
  const slotsByDate: Record<string, TripTimeSlot[]> = {};
  for (const slot of slots) {
    if (!slotsByDate[slot.slot_date]) {
      slotsByDate[slot.slot_date] = [];
    }
    slotsByDate[slot.slot_date].push(slot);
  }
  const sortedDates = Object.keys(slotsByDate).sort();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Manage Meal & Chore Slots"
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.6)",
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
          maxWidth: "860px",
          width: "100%",
          maxHeight: "90vh",
          overflowY: "auto",
          backgroundColor: "#fff",
          position: "relative",
          display: "flex",
          flexDirection: "column",
          gap: "1rem",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h2 style={{ margin: "0 0 0.25rem 0" }}>🍽️ Manage Meal &amp; Chore Slots</h2>
            <p className="eyebrow" style={{ margin: 0 }}>
              {tripStartsOn && tripEndsOn ? `${tripStartsOn} to ${tripEndsOn}` : "Trip Schedule"} · Candidate &amp; Custom Time Slots
            </p>
          </div>
          <button
            type="button"
            className="secondary-button"
            style={{ padding: "0.25rem 0.6rem", fontSize: "0.9rem" }}
            onClick={onClose}
            disabled={busy}
          >
            ✕ Close
          </button>
        </div>

        {/* Alerts */}
        {error && (
          <div role="alert" className="banner error" style={{ margin: 0 }}>
            {error}
          </div>
        )}
        {successMsg && (
          <div role="alert" className="banner success" style={{ margin: 0 }}>
            {successMsg}
          </div>
        )}

        {/* Action toolbar */}
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
          <button
            type="button"
            className="primary-button"
            style={{ fontSize: "0.85rem", padding: "0.35rem 0.75rem" }}
            onClick={() => handleGenerateSlots(slots.length > 0)}
            disabled={busy || loading}
          >
            {slots.length === 0 ? "✨ Generate Candidate Slots" : "🔄 Regenerate Candidate Slots"}
          </button>

          <button
            type="button"
            className="secondary-button"
            style={{ fontSize: "0.85rem", padding: "0.35rem 0.75rem" }}
            onClick={() => setShowAddCustom(!showAddCustom)}
            disabled={busy || loading}
          >
            {showAddCustom ? "Cancel Custom Slot" : "➕ Add Custom Slot"}
          </button>
        </div>

        {/* Custom Slot Form */}
        {showAddCustom && (
          <form
            onSubmit={handleCreateCustomSlot}
            className="card"
            style={{ backgroundColor: "#f9fafb", border: "1px solid #e5e7eb", padding: "1rem" }}
          >
            <h3 style={{ margin: "0 0 0.75rem 0", fontSize: "1rem" }}>Add Custom Time Slot</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.75rem" }}>
              <div>
                <label htmlFor="custom-slot-date" style={{ display: "block", fontSize: "0.8rem", fontWeight: "bold" }}>
                  Date *
                </label>
                <input
                  id="custom-slot-date"
                  type="date"
                  value={customDate}
                  onChange={(e) => setCustomDate(e.target.value)}
                  required
                  style={{ width: "100%", padding: "0.35rem" }}
                />
              </div>

              <div>
                <label htmlFor="custom-time-block" style={{ display: "block", fontSize: "0.8rem", fontWeight: "bold" }}>
                  Time Block *
                </label>
                <input
                  id="custom-time-block"
                  type="text"
                  placeholder="e.g. afternoon, evening"
                  value={customTimeBlock}
                  onChange={(e) => setCustomTimeBlock(e.target.value)}
                  required
                  style={{ width: "100%", padding: "0.35rem" }}
                />
              </div>

              <div>
                <label htmlFor="custom-slot-type" style={{ display: "block", fontSize: "0.8rem", fontWeight: "bold" }}>
                  Type *
                </label>
                <select
                  id="custom-slot-type"
                  value={customSlotType}
                  onChange={(e) => setCustomSlotType(e.target.value as "meal" | "chore" | "activity" | "general")}
                  style={{ width: "100%", padding: "0.35rem" }}
                >
                  <option value="meal">Meal</option>
                  <option value="chore">Chore</option>
                  <option value="activity">Activity</option>
                  <option value="general">General</option>
                </select>
              </div>

              <div>
                <label htmlFor="custom-slot-label" style={{ display: "block", fontSize: "0.8rem", fontWeight: "bold" }}>
                  Label *
                </label>
                <input
                  id="custom-slot-label"
                  type="text"
                  placeholder="e.g. Saturday Campfire Stories"
                  value={customLabel}
                  onChange={(e) => setCustomLabel(e.target.value)}
                  required
                  style={{ width: "100%", padding: "0.35rem" }}
                />
              </div>
            </div>

            <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem" }}>
              <button type="submit" className="primary-button" style={{ fontSize: "0.85rem", padding: "0.3rem 0.75rem" }} disabled={busy}>
                Create Slot
              </button>
              <button
                type="button"
                className="secondary-button"
                style={{ fontSize: "0.85rem", padding: "0.3rem 0.75rem" }}
                onClick={() => setShowAddCustom(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* Content Body */}
        {loading ? (
          <p style={{ textAlign: "center", color: "#6b7280" }}>Loading time slots and duties...</p>
        ) : slots.length === 0 ? (
          <div className="card" style={{ textAlign: "center", padding: "2rem", backgroundColor: "#f9fafb" }}>
            <p style={{ fontSize: "1.1rem", fontWeight: "600", margin: "0 0 0.5rem 0" }}>No Meal or Chore Slots Yet</p>
            <p style={{ color: "#6b7280", margin: "0 0 1rem 0" }}>
              Click <strong>&quot;Generate Candidate Slots&quot;</strong> to automatically suggest standard Friday–Sunday breakfast, lunch, dinner, and cleanup duties based on trip dates.
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
            {sortedDates.map((dateStr) => (
              <div key={dateStr} style={{ border: "1px solid #e5e7eb", borderRadius: "8px", overflow: "hidden" }}>
                {/* Date header */}
                <div
                  style={{
                    backgroundColor: "#f3f4f6",
                    padding: "0.5rem 1rem",
                    fontWeight: "bold",
                    fontSize: "0.95rem",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <span>📅 {dateStr}</span>
                  <span style={{ fontSize: "0.8rem", color: "#6b7280" }}>
                    {slotsByDate[dateStr].length} {slotsByDate[dateStr].length === 1 ? "slot" : "slots"}
                  </span>
                </div>

                {/* Slots on this date */}
                <div style={{ padding: "0.75rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                  {slotsByDate[dateStr].map((slot) => {
                    const isSlotEnabled = slot.is_enabled;
                    return (
                      <div
                        key={slot.id}
                        style={{
                          border: "1px solid #e5e7eb",
                          borderRadius: "6px",
                          padding: "0.75rem",
                          backgroundColor: isSlotEnabled ? "#ffffff" : "#f9fafb",
                          opacity: isSlotEnabled ? 1 : 0.75,
                        }}
                      >
                        {/* Slot Header */}
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "0.5rem" }}>
                          <div>
                            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                              <span style={{ fontSize: "1.1rem" }}>
                                {slot.slot_type === "meal" ? "🍳" : slot.slot_type === "chore" ? "🧹" : slot.slot_type === "activity" ? "🎯" : "📌"}
                              </span>
                              <strong style={{ fontSize: "0.95rem" }}>{slot.label}</strong>
                              <span
                                style={{
                                  fontSize: "0.7rem",
                                  padding: "0.1rem 0.4rem",
                                  borderRadius: "4px",
                                  backgroundColor: slot.slot_type === "meal" ? "#dbeafe" : "#fef3c7",
                                  color: slot.slot_type === "meal" ? "#1e40af" : "#92400e",
                                  textTransform: "uppercase",
                                  fontWeight: "bold",
                                }}
                              >
                                {slot.slot_type}
                              </span>
                              {!isSlotEnabled && (
                                <span
                                  style={{
                                    fontSize: "0.7rem",
                                    padding: "0.1rem 0.4rem",
                                    borderRadius: "4px",
                                    backgroundColor: "#fee2e2",
                                    color: "#991b1b",
                                    fontWeight: "bold",
                                  }}
                                >
                                  Disabled
                                </span>
                              )}
                              {slot.is_custom && (
                                <span style={{ fontSize: "0.7rem", color: "#6b7280" }}>(Custom)</span>
                              )}
                            </div>
                            <span style={{ fontSize: "0.75rem", color: "#6b7280", marginLeft: "1.6rem" }}>
                              Time block: {slot.time_block}
                            </span>
                          </div>

                          <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                            <button
                              type="button"
                              className="secondary-button"
                              style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem" }}
                              onClick={() => handleToggleSlotEnabled(slot)}
                              disabled={busy}
                            >
                              {isSlotEnabled ? "Disable Slot" : "Enable Slot"}
                            </button>

                            <button
                              type="button"
                              className="secondary-button"
                              style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem" }}
                              onClick={() => {
                                setActiveSlotForDuty(activeSlotForDuty === slot.id ? null : slot.id);
                              }}
                              disabled={busy || !isSlotEnabled}
                            >
                              {activeSlotForDuty === slot.id ? "Cancel Add Duty" : "+ Add Duty"}
                            </button>
                          </div>
                        </div>

                        {/* Add Duty Form for this slot */}
                        {activeSlotForDuty === slot.id && (
                          <form
                            onSubmit={handleAddDuty}
                            style={{
                              marginTop: "0.75rem",
                              padding: "0.5rem",
                              backgroundColor: "#f3f4f6",
                              borderRadius: "4px",
                              display: "flex",
                              flexWrap: "wrap",
                              gap: "0.5rem",
                              alignItems: "flex-end",
                            }}
                          >
                            <div style={{ flex: "1 1 200px" }}>
                              <label htmlFor={`duty-resp-${slot.id}`} style={{ display: "block", fontSize: "0.75rem", fontWeight: "bold" }}>
                                Responsibility Template *
                              </label>
                              <select
                                id={`duty-resp-${slot.id}`}
                                value={selectedRespId}
                                onChange={(e) => handleRespSelectChange(e.target.value)}
                                style={{ width: "100%", padding: "0.25rem", fontSize: "0.85rem" }}
                                required
                              >
                                {responsibilities.map((r) => (
                                  <option key={r.id} value={r.id}>
                                    {r.title} ({r.category.replace("_", " ")}, {r.workload_weight}x)
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div style={{ width: "80px" }}>
                              <label htmlFor={`duty-cap-${slot.id}`} style={{ display: "block", fontSize: "0.75rem", fontWeight: "bold" }}>
                                Capacity
                              </label>
                              <input
                                id={`duty-cap-${slot.id}`}
                                type="number"
                                min={1}
                                max={20}
                                value={dutyCapacity}
                                onChange={(e) => setDutyCapacity(Number(e.target.value))}
                                style={{ width: "100%", padding: "0.25rem", fontSize: "0.85rem" }}
                              />
                            </div>

                            <div style={{ width: "80px" }}>
                              <label htmlFor={`duty-wt-${slot.id}`} style={{ display: "block", fontSize: "0.75rem", fontWeight: "bold" }}>
                                Weight
                              </label>
                              <input
                                id={`duty-wt-${slot.id}`}
                                type="number"
                                step={0.5}
                                min={0.5}
                                max={5.0}
                                value={dutyWeight}
                                onChange={(e) => setDutyWeight(Number(e.target.value))}
                                style={{ width: "100%", padding: "0.25rem", fontSize: "0.85rem" }}
                              />
                            </div>

                            <button type="submit" className="primary-button" style={{ fontSize: "0.8rem", padding: "0.25rem 0.6rem" }} disabled={busy}>
                              Save Duty
                            </button>
                          </form>
                        )}

                        {/* Duties List */}
                        <div style={{ marginTop: "0.5rem", paddingLeft: "1.6rem" }}>
                          {(!slot.duties || slot.duties.length === 0) ? (
                            <p style={{ fontSize: "0.8rem", color: "#9ca3af", margin: "0.25rem 0" }}>
                              No duties added to this time slot.
                            </p>
                          ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                              {slot.duties.map((duty) => {
                                const title = duty.responsibility?.title ?? "Responsibility Duty";
                                const category = duty.responsibility?.category ?? "chore";
                                return (
                                  <div
                                    key={duty.id}
                                    style={{
                                      display: "flex",
                                      justifyContent: "space-between",
                                      alignItems: "center",
                                      fontSize: "0.85rem",
                                      padding: "0.35rem 0.5rem",
                                      backgroundColor: duty.is_active ? "#f8fafc" : "#f1f5f9",
                                      borderRadius: "4px",
                                      border: "1px solid #e2e8f0",
                                      opacity: duty.is_active ? 1 : 0.65,
                                    }}
                                  >
                                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                                      <span>{title}</span>
                                      <span style={{ fontSize: "0.7rem", color: "#64748b" }}>
                                        ({category.replace("_", " ")}) · {duty.workload_weight}x weight
                                      </span>
                                      {!duty.is_active && (
                                        <span style={{ fontSize: "0.7rem", color: "#ef4444", fontWeight: "bold" }}>
                                          [Inactive]
                                        </span>
                                      )}
                                    </div>

                                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                                      {/* Capacity Stepper */}
                                      <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
                                        <span style={{ fontSize: "0.75rem", color: "#64748b" }}>Capacity:</span>
                                        <button
                                          type="button"
                                          aria-label="Decrease capacity"
                                          disabled={busy || duty.capacity <= 1}
                                          style={{ padding: "0.1rem 0.35rem", fontSize: "0.75rem" }}
                                          onClick={() => handleUpdateDutyCapacity(duty, duty.capacity - 1)}
                                        >
                                          -
                                        </button>
                                        <strong style={{ minWidth: "16px", textAlign: "center" }}>{duty.capacity}</strong>
                                        <button
                                          type="button"
                                          aria-label="Increase capacity"
                                          disabled={busy || duty.capacity >= 20}
                                          style={{ padding: "0.1rem 0.35rem", fontSize: "0.75rem" }}
                                          onClick={() => handleUpdateDutyCapacity(duty, duty.capacity + 1)}
                                        >
                                          +
                                        </button>
                                      </div>

                                      {/* Toggle Active */}
                                      <button
                                        type="button"
                                        className="secondary-button"
                                        style={{ fontSize: "0.7rem", padding: "0.15rem 0.4rem" }}
                                        onClick={() => handleToggleDutyActive(duty)}
                                        disabled={busy}
                                      >
                                        {duty.is_active ? "Deactivate" : "Activate"}
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Modal footer */}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "auto", paddingTop: "0.5rem" }}>
          <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>
            Done
          </button>
        </div>
      </div>

      {/* Confirmation Modal for Disabling Slot */}
      {confirmDisableSlot && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Confirm Disable Slot"
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0, 0, 0, 0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1100,
            padding: "1rem",
          }}
        >
          <div className="card" style={{ maxWidth: "450px", width: "100%", backgroundColor: "#fff" }}>
            <h3 style={{ margin: "0 0 0.5rem 0" }}>⚠️ Disable Time Slot?</h3>
            <p style={{ margin: "0 0 1rem 0", fontSize: "0.9rem", color: "#4b5563" }}>
              Are you sure you want to disable <strong>&quot;{confirmDisableSlot.label}&quot;</strong>?
              Disabling hides this slot from volunteer sign-ups while preserving historical records and duty configurations.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setConfirmDisableSlot(null)}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary-button"
                style={{ backgroundColor: "#dc2626", borderColor: "#dc2626" }}
                onClick={executeDisableSlot}
                disabled={busy}
              >
                Yes, Disable Slot
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
