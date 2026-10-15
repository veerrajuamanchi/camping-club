import { useEffect, useState } from "react";
import { Link } from "react-router";
import { invokeTripApi, TripApiError } from "../../lib/supabase";
import type { TripApi } from "../trips/TripCalendarPage";

const defaultApi: TripApi = (action, input, key) => invokeTripApi(action, input, key);

export type ResponsibilityCategory = "meal_prep" | "cooking" | "cleanup" | "activities" | "transport" | "other";

export interface MasterResponsibility {
  id: string;
  title: string;
  description: string | null;
  category: ResponsibilityCategory;
  default_capacity: number;
  workload_weight: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

const CATEGORY_LABELS: Record<ResponsibilityCategory, { label: string; icon: string }> = {
  meal_prep: { label: "Meal Prep", icon: "🥗" },
  cooking: { label: "Cooking", icon: "🍳" },
  cleanup: { label: "Cleanup", icon: "🧹" },
  transport: { label: "Transport & Driving", icon: "🚗" },
  activities: { label: "Activities & Games", icon: "🎯" },
  other: { label: "General & Campfire", icon: "🪵" },
};

export function MasterResponsibilitiesPage({ api = defaultApi }: { api?: TripApi }) {
  const [responsibilities, setResponsibilities] = useState<MasterResponsibility[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [showRetired, setShowRetired] = useState(true);

  // Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<MasterResponsibility | null>(null);
  const [saving, setSaving] = useState(false);

  // Form Fields
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<ResponsibilityCategory>("meal_prep");
  const [description, setDescription] = useState("");
  const [defaultCapacity, setDefaultCapacity] = useState("1");
  const [workloadWeight, setWorkloadWeight] = useState("1.0");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ responsibilities: MasterResponsibility[] }>("admin_list_master_responsibilities", {
        includeInactive: true,
      });
      setResponsibilities(data.responsibilities ?? []);
    } catch {
      setError("Could not load master responsibilities. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function openCreateModal() {
    setEditingItem(null);
    setTitle("");
    setCategory("meal_prep");
    setDescription("");
    setDefaultCapacity("1");
    setWorkloadWeight("1.0");
    setModalOpen(true);
  }

  function openEditModal(item: MasterResponsibility) {
    setEditingItem(item);
    setTitle(item.title);
    setCategory(item.category);
    setDescription(item.description ?? "");
    setDefaultCapacity(String(item.default_capacity));
    setWorkloadWeight(String(item.workload_weight));
    setModalOpen(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const cleanTitle = title.trim();
    if (cleanTitle.length < 3) {
      setError("Title must be at least 3 characters long.");
      return;
    }
    if (cleanTitle.length > 100) {
      setError("Title cannot exceed 100 characters.");
      return;
    }
    const capNum = Number(defaultCapacity);
    if (!Number.isInteger(capNum) || capNum < 1 || capNum > 20) {
      setError("Default capacity must be an integer between 1 and 20.");
      return;
    }
    const weightNum = Number(workloadWeight);
    if (isNaN(weightNum) || weightNum < 0.5 || weightNum > 5.0) {
      setError("Workload weight must be between 0.5 and 5.0.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      if (editingItem) {
        await api("admin_update_master_responsibility", {
          id: editingItem.id,
          title: cleanTitle,
          description: description.trim() || null,
          category,
          defaultCapacity: capNum,
          workloadWeight: weightNum,
          active: editingItem.active,
        });
      } else {
        await api("admin_create_master_responsibility", {
          title: cleanTitle,
          description: description.trim() || null,
          category,
          defaultCapacity: capNum,
          workloadWeight: weightNum,
        });
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      if (err instanceof TripApiError) {
        if (err.status === 409) {
          setError("This responsibility was modified by another administrator. Please refresh and try again.");
        } else if (err.status === 403) {
          setError("Permission denied. Administrator access is required.");
        } else {
          setError(
            err.message && err.message !== "The trip request could not be completed."
              ? err.message
              : "Could not save responsibility. Verify title length (3–100 chars), capacity (1–20), and workload weight (0.5–5.0)."
          );
        }
      } else {
        setError((err as any)?.message || "Operation failed. Please check network connection and try again.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(item: MasterResponsibility) {
    setError(null);
    try {
      await api("admin_update_master_responsibility", {
        id: item.id,
        title: item.title,
        description: item.description,
        category: item.category,
        defaultCapacity: item.default_capacity,
        workloadWeight: item.workload_weight,
        active: !item.active,
      });
      await load();
    } catch {
      setError("Could not update responsibility status.");
    }
  }

  const activeItems = responsibilities.filter((item) => item.active);
  const activeWeightTenths = activeItems.reduce((sum, item) => sum + Math.round(Number(item.workload_weight) * 10), 0);
  const capacityWeightTenths = activeItems.reduce((sum, item) => sum + Math.round(Number(item.workload_weight) * 10) * item.default_capacity, 0);

  const filteredItems = responsibilities.filter((item) => {
    if (!showRetired && !item.active) return false;
    if (selectedCategory !== "all" && item.category !== selectedCategory) return false;
    return true;
  });

  return (
    <section className="admin-page">
      <div className="admin-header-row">
        <div>
          <Link to="/" className="back-link">
            ← Back to Trips
          </Link>
          <h2>🛠️ Master Responsibilities Directory</h2>
          <p className="admin-subtitle">
            Reusable chore and duty templates for camp trips. Tasks can be attached to Friday, Saturday, and Sunday time slots.
          </p>
        </div>
        <button type="button" className="btn-primary" onClick={openCreateModal}>
          + Add Responsibility
        </button>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}

      {loading ? (
        <p role="status">Loading master responsibilities…</p>
      ) : (
        <>
          <section className="card" aria-label="Active workload summary" style={{ marginBottom: "1rem" }}>
            <h3>Active workload</h3>
            <p>{activeItems.length} active responsibilities</p>
            <p>Total active task weight: <output aria-label="Total active template weight">{(activeWeightTenths / 10).toFixed(1)}×</output></p>
            <p>Total volunteer capacity: <output aria-label="Total active volunteer capacity weight">{(capacityWeightTenths / 10).toFixed(1)}×</output></p>
            <p>Volunteer capacity includes every slot: a 2× task with three volunteers provides 6× of workload capacity.
              Daily requirements depend on the tasks scheduled for that date.</p>
          </section>

          <div className="filter-bar" style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center", marginBottom: "20px" }}>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              <button
                type="button"
                className={`filter-btn ${selectedCategory === "all" ? "active" : ""}`}
                onClick={() => setSelectedCategory("all")}
              >
                All ({responsibilities.length})
              </button>
              {(Object.keys(CATEGORY_LABELS) as ResponsibilityCategory[]).map((catKey) => {
                const count = responsibilities.filter((r) => r.category === catKey).length;
                return (
                  <button
                    key={catKey}
                    type="button"
                    className={`filter-btn ${selectedCategory === catKey ? "active" : ""}`}
                    onClick={() => setSelectedCategory(catKey)}
                  >
                    {CATEGORY_LABELS[catKey].icon} {CATEGORY_LABELS[catKey].label} ({count})
                  </button>
                );
              })}
            </div>
            <label style={{ marginLeft: "auto", fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", minHeight: "44px", maxWidth: "100%" }}>
              <input
                type="checkbox"
                style={{ width: "18px", height: "18px", flex: "0 0 18px", margin: 0, padding: 0 }}
                checked={showRetired}
                onChange={(e) => setShowRetired(e.target.checked)}
              />
              <span>Show retired templates</span>
            </label>
          </div>

          <div className="responsibilities-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 320px), 1fr))", gap: "16px" }}>
            {filteredItems.map((item) => (
              <div
                key={item.id}
                className="event-card"
                style={{
                  padding: "16px",
                  minWidth: 0,
                  overflowWrap: "anywhere",
                  borderRadius: "10px",
                  border: item.active ? "1px solid #e2e8f0" : "1px dashed #cbd5e1",
                  background: item.active ? "#ffffff" : "#f8fafc",
                  opacity: item.active ? 1 : 0.75,
                }}
              >
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
                  <span
                    style={{
                      fontSize: "0.75rem",
                      fontWeight: 600,
                      padding: "3px 8px",
                      borderRadius: "6px",
                      background: "#e0f2fe",
                      color: "#0369a1",
                    }}
                  >
                    {CATEGORY_LABELS[item.category]?.icon ?? "📌"} {CATEGORY_LABELS[item.category]?.label ?? item.category}
                  </span>
                  <span
                    style={{
                      fontSize: "0.75rem",
                      fontWeight: 600,
                      padding: "2px 6px",
                      borderRadius: "4px",
                      background: item.active ? "#dcfce7" : "#f1f5f9",
                      color: item.active ? "#15803d" : "#64748b",
                    }}
                  >
                    {item.active ? "Active" : "Retired"}
                  </span>
                </div>

                <h3 style={{ fontSize: "1.05rem", margin: "4px 0 6px 0", color: "#0f172a" }}>{item.title}</h3>
                {item.description && (
                  <p style={{ fontSize: "0.85rem", color: "#64748b", margin: "0 0 12px 0", minHeight: "36px" }}>
                    {item.description}
                  </p>
                )}

                <div
                  style={{
                    display: "flex",
                    gap: "12px",
                    flexWrap: "wrap",
                    fontSize: "0.8rem",
                    color: "#475569",
                    marginBottom: "12px",
                    paddingTop: "8px",
                    borderTop: "1px solid #f1f5f9",
                  }}
                >
                  <div>
                    👥 <strong>{item.default_capacity} {item.default_capacity === 1 ? "volunteer" : "volunteers"}</strong>
                  </div>
                  <div>
                    ⚖️ <strong>{Number(item.workload_weight).toFixed(1)}x weight</strong>
                  </div>
                </div>

                <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    style={{ fontSize: "0.8rem", padding: "4px 10px" }}
                    onClick={() => openEditModal(item)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    style={{
                      fontSize: "0.8rem",
                      padding: "4px 10px",
                      background: item.active ? "#fff1f2" : "#f0fdf4",
                      color: item.active ? "#be123c" : "#15803d",
                      border: "1px solid transparent",
                      borderRadius: "6px",
                      cursor: "pointer",
                    }}
                    onClick={() => void toggleActive(item)}
                  >
                    {item.active ? "Retire" : "Reactivate"}
                  </button>
                </div>
              </div>
            ))}
          </div>

          {filteredItems.length === 0 && (
            <p style={{ textAlign: "center", color: "#94a3b8", padding: "40px" }}>
              No master responsibilities match the selected filter.
            </p>
          )}
        </>
      )}

      {modalOpen && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ maxWidth: "480px" }}>
            <h3>{editingItem ? "Edit Master Responsibility" : "Add Master Responsibility"}</h3>
            {error && <p className="form-error" role="alert" style={{ marginBottom: "12px" }}>{error}</p>}
            <form onSubmit={handleSave} className="form-vertical" style={{ marginTop: "16px" }}>
              <label>
                Title *
                <input
                  type="text"
                  required
                  minLength={3}
                  maxLength={100}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Campfire Setup, Dinner Cook"
                />
              </label>

              <label>
                Category *
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as ResponsibilityCategory)}
                >
                  <option value="meal_prep">Meal Prep</option>
                  <option value="cooking">Cooking</option>
                  <option value="cleanup">Cleanup</option>
                  <option value="transport">Transport & Driving</option>
                  <option value="activities">Activities & Games</option>
                  <option value="other">General & Campfire</option>
                </select>
              </label>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <label>
                  Default Capacity *
                  <input
                    type="number"
                    required
                    min={1}
                    max={20}
                    value={defaultCapacity}
                    onChange={(e) => setDefaultCapacity(e.target.value)}
                  />
                </label>
                <label>
                  Workload Weight *
                  <input
                    type="number"
                    step="0.5"
                    required
                    min={0.5}
                    max={5.0}
                    value={workloadWeight}
                    onChange={(e) => setWorkloadWeight(e.target.value)}
                  />
                </label>
              </div>

              <label>
                Description
                <textarea
                  rows={3}
                  maxLength={500}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Explain duties, equipment needed, or safety rules..."
                />
              </label>

              <div className="modal-actions" style={{ display: "flex", gap: "10px", justifyContent: "flex-end", marginTop: "16px" }}>
                <button type="button" className="btn-secondary" onClick={() => setModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={saving}>
                  {saving ? "Saving…" : "Save Responsibility"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
