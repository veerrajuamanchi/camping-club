import { useEffect, useState } from "react";
import { invokeTripApi, TripApiError } from "../../lib/supabase";
import type { TripApi } from "../trips/TripCalendarPage";

const defaultApi: TripApi = (action, input, key) => invokeTripApi(action, input, key);

export type ActivityCategory =
  | "tour"
  | "water"
  | "outdoor"
  | "entertainment"
  | "other";

export interface MasterActivityItem {
  id: string;
  title: string;
  category: string;
  image_url: string | null;
  location_name: string | null;
  address: string | null;
  directions_url: string | null;
  unit_label: string;
  unit_capacity: number;
  booking_notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface MasterActivitiesTabProps {
  api?: TripApi;
  activities?: MasterActivityItem[];
  onRefresh?: () => Promise<void> | void;
}

export const ACTIVITY_CATEGORY_LABELS: Record<string, { label: string; icon: string }> = {
  tour: { label: "Tour & Sightseeing", icon: "🗺️" },
  water: { label: "Water Sports", icon: "🛶" },
  outdoor: { label: "Outdoor & Adventure", icon: "🏔️" },
  entertainment: { label: "Entertainment & Games", icon: "🎪" },
  other: { label: "Other / Leisure", icon: "🎯" },
};

export function MasterActivitiesTab({
  api = defaultApi,
  activities: initialActivities,
  onRefresh,
}: MasterActivitiesTabProps) {
  const [items, setItems] = useState<MasterActivityItem[]>(initialActivities ?? []);
  const [loading, setLoading] = useState(!initialActivities);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [showInactive, setShowInactive] = useState(true);

  // Modal State for Add / Edit
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<MasterActivityItem | null>(null);
  const [saving, setSaving] = useState(false);

  // Form Fields
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("tour");
  const [imageUrl, setImageUrl] = useState("");
  const [locationName, setLocationName] = useState("");
  const [address, setAddress] = useState("");
  const [directionsUrl, setDirectionsUrl] = useState("");
  const [unitLabel, setUnitLabel] = useState("Vehicle");
  const [unitCapacity, setUnitCapacity] = useState("2");
  const [bookingNotes, setBookingNotes] = useState("");

  // Modal State for Delete
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deletingItem, setDeletingItem] = useState<MasterActivityItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (initialActivities) {
      setItems(initialActivities);
      setLoading(false);
    }
  }, [initialActivities]);

  async function load() {
    if (onRefresh) {
      await onRefresh();
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ activities?: MasterActivityItem[] }>("get_master_activities", {
        includeInactive: true,
      });
      if (res && Array.isArray(res.activities)) {
        setItems(res.activities);
      } else if (Array.isArray(res)) {
        setItems(res);
      }
    } catch {
      try {
        const catRes = await api<{ activities?: MasterActivityItem[] }>("get_master_catalogs", {
          includeInactive: true,
        });
        if (catRes && Array.isArray(catRes.activities)) {
          setItems(catRes.activities);
        }
      } catch {
        setError("Failed to load activity templates.");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!initialActivities) {
      void load();
    }
  }, []);

  function openAddModal() {
    setError(null);
    setEditingItem(null);
    setTitle("");
    setCategory("tour");
    setImageUrl("");
    setLocationName("");
    setAddress("");
    setDirectionsUrl("");
    setUnitLabel("Vehicle");
    setUnitCapacity("2");
    setBookingNotes("");
    setFormModalOpen(true);
  }

  function openEditModal(item: MasterActivityItem) {
    setError(null);
    setEditingItem(item);
    setTitle(item.title);
    setCategory(item.category || "tour");
    setImageUrl(item.image_url || "");
    setLocationName(item.location_name || "");
    setAddress(item.address || "");
    setDirectionsUrl(item.directions_url || "");
    setUnitLabel(item.unit_label || "Vehicle");
    setUnitCapacity(String(item.unit_capacity || 2));
    setBookingNotes(item.booking_notes || "");
    setFormModalOpen(true);
  }

  function openDeleteModal(item: MasterActivityItem) {
    setError(null);
    setDeletingItem(item);
    setDeleteModalOpen(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const cleanTitle = title.trim();
    if (cleanTitle.length < 1 || cleanTitle.length > 200) {
      setError("Activity title must be between 1 and 200 characters.");
      setSaving(false);
      return;
    }

    const cap = Number(unitCapacity);
    if (!Number.isInteger(cap) || cap < 1) {
      setError("Unit capacity must be a positive integer.");
      setSaving(false);
      return;
    }

    const cleanUnitLabel = unitLabel.trim() || "Vehicle";

    try {
      if (editingItem) {
        await api("admin_manage_master_activity", {
          action: "update",
          id: editingItem.id,
          title: cleanTitle,
          category,
          imageUrl: imageUrl.trim() || null,
          locationName: locationName.trim() || null,
          address: address.trim() || null,
          directionsUrl: directionsUrl.trim() || null,
          unitLabel: cleanUnitLabel,
          unitCapacity: cap,
          bookingNotes: bookingNotes.trim() || null,
        });
      } else {
        await api("admin_manage_master_activity", {
          action: "create",
          title: cleanTitle,
          category,
          imageUrl: imageUrl.trim() || null,
          locationName: locationName.trim() || null,
          address: address.trim() || null,
          directionsUrl: directionsUrl.trim() || null,
          unitLabel: cleanUnitLabel,
          unitCapacity: cap,
          bookingNotes: bookingNotes.trim() || null,
        });
      }

      setFormModalOpen(false);
      await load();
    } catch (err) {
      if (err instanceof TripApiError) {
        setError(err.message || "Failed to save activity template.");
      } else {
        setError((err as any)?.message || "Failed to save activity template.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(item: MasterActivityItem) {
    setError(null);
    try {
      await api("admin_manage_master_activity", {
        action: "update",
        id: item.id,
        isActive: !item.is_active,
      });
      await load();
    } catch (err) {
      if (err instanceof TripApiError) {
        setError(err.message || "Could not update activity status.");
      } else {
        setError("Could not update activity status.");
      }
    }
  }

  async function handleConfirmDelete() {
    if (!deletingItem) return;
    setDeleting(true);
    setError(null);

    try {
      await api("admin_manage_master_activity", {
        action: "delete",
        id: deletingItem.id,
      });
      setDeleteModalOpen(false);
      setDeletingItem(null);
      await load();
    } catch (err) {
      if (err instanceof TripApiError) {
        setError(err.message || "Could not delete activity template.");
      } else {
        setError((err as any)?.message || "Could not delete activity template.");
      }
    } finally {
      setDeleting(false);
    }
  }

  // Filtered items
  const cleanQuery = searchQuery.trim().toLowerCase();
  const filtered = items.filter((item) => {
    if (!showInactive && !item.is_active) return false;
    if (categoryFilter !== "all" && item.category !== categoryFilter) return false;
    if (cleanQuery) {
      const matchTitle = item.title.toLowerCase().includes(cleanQuery);
      const matchCat = item.category.toLowerCase().includes(cleanQuery);
      const matchLoc = item.location_name?.toLowerCase().includes(cleanQuery) ?? false;
      const matchAddr = item.address?.toLowerCase().includes(cleanQuery) ?? false;
      const matchNotes = item.booking_notes?.toLowerCase().includes(cleanQuery) ?? false;
      if (!matchTitle && !matchCat && !matchLoc && !matchAddr && !matchNotes) return false;
    }
    return true;
  });

  return (
    <div className="master-activities-tab">
      {/* Top action row */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "12px",
          marginBottom: "1rem",
        }}
      >
        <div>
          <h3 style={{ margin: "0 0 4px 0", fontSize: "1.1rem" }}>🎯 Activity Templates</h3>
          <p style={{ margin: 0, color: "#64748b", fontSize: "0.85rem" }}>
            Preconfigured excursions, tours, and recreation templates with vehicle/unit capacities and booking notes.
          </p>
        </div>
        <button
          type="button"
          className="btn-primary"
          onClick={openAddModal}
          style={{ padding: "0.55rem 1.1rem" }}
        >
          + Add Activity Template
        </button>
      </div>

      {error && (
        <p className="form-error" role="alert" style={{ marginBottom: "1rem" }}>
          {error}
        </p>
      )}

      {/* Filter Bar */}
      <div
        className="filter-bar"
        style={{
          display: "flex",
          gap: "12px",
          flexWrap: "wrap",
          alignItems: "center",
          marginBottom: "1.25rem",
        }}
      >
        <div style={{ flex: "1 1 240px", minWidth: "200px" }}>
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search activities by title, location, or notes…"
            style={{
              width: "100%",
              padding: "0.55rem 0.85rem",
              borderRadius: "8px",
              border: "1px solid #cbd5e1",
            }}
            aria-label="Search activities"
          />
        </div>

        {/* Category Filter Pills */}
        <div className="rsvp-pills" style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          <button
            type="button"
            className={`rsvp-pill-btn ${categoryFilter === "all" ? "active" : ""}`}
            onClick={() => setCategoryFilter("all")}
          >
            All ({items.length})
          </button>
          {Object.entries(ACTIVITY_CATEGORY_LABELS).map(([catKey, info]) => {
            const count = items.filter((a) => a.category === catKey).length;
            if (count === 0 && categoryFilter !== catKey) return null;
            return (
              <button
                key={catKey}
                type="button"
                className={`rsvp-pill-btn ${categoryFilter === catKey ? "active" : ""}`}
                onClick={() => setCategoryFilter(catKey)}
              >
                {info.icon} {catKey.charAt(0).toUpperCase() + catKey.slice(1)} ({count})
              </button>
            );
          })}
        </div>

        <label
          style={{
            marginLeft: "auto",
            fontSize: "0.85rem",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            cursor: "pointer",
            minHeight: "44px",
          }}
        >
          <input
            type="checkbox"
            style={{ width: "18px", height: "18px" }}
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          <span>Show inactive / retired</span>
        </label>
      </div>

      {loading ? (
        <p role="status">Loading master activities…</p>
      ) : filtered.length === 0 ? (
        <p style={{ textAlign: "center", color: "#94a3b8", padding: "40px 0" }}>
          No activity templates match your filter criteria.
        </p>
      ) : (
        <div
          className="catalog-grid"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 320px), 1fr))",
            gap: "16px",
          }}
        >
          {filtered.map((item) => {
            const catInfo = ACTIVITY_CATEGORY_LABELS[item.category] ?? {
              label: item.category,
              icon: "🎯",
            };
            return (
              <div
                key={item.id}
                className="event-card"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  borderRadius: "10px",
                  border: item.is_active ? "1px solid #e2e8f0" : "1px dashed #cbd5e1",
                  background: item.is_active ? "#ffffff" : "#f8fafc",
                  opacity: item.is_active ? 1 : 0.75,
                  overflow: "hidden",
                }}
              >
                {/* Image preview / banner with fallback */}
                <div
                  style={{
                    height: "140px",
                    width: "100%",
                    background: "#f1f5f9",
                    position: "relative",
                    overflow: "hidden",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {item.image_url ? (
                    <img
                      src={item.image_url}
                      alt={item.title}
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      onError={(e) => {
                        (e.currentTarget as HTMLElement).style.display = "none";
                        const fallback = e.currentTarget.parentElement?.querySelector(".img-fallback") as HTMLElement | null;
                        if (fallback) fallback.style.display = "flex";
                      }}
                    />
                  ) : null}
                  <div
                    className="img-fallback"
                    style={{
                      display: item.image_url ? "none" : "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#94a3b8",
                      fontSize: "0.85rem",
                      gap: "4px",
                    }}
                  >
                    <span style={{ fontSize: "2.2rem" }}>{catInfo.icon}</span>
                    <span style={{ fontWeight: 500 }}>No Image Preview</span>
                  </div>
                </div>

                <div style={{ padding: "14px", display: "flex", flexDirection: "column", flex: 1, gap: "8px" }}>
                  {/* Badges row */}
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "6px",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                    }}
                  >
                    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
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
                        {catInfo.icon} {item.category.charAt(0).toUpperCase() + item.category.slice(1)}
                      </span>
                      <span
                        style={{
                          fontSize: "0.75rem",
                          fontWeight: 600,
                          padding: "3px 8px",
                          borderRadius: "6px",
                          background: "#fef3c7",
                          color: "#92400e",
                        }}
                      >
                        👥 {item.unit_capacity} per {item.unit_label || "Vehicle"}
                      </span>
                    </div>

                    <span
                      style={{
                        fontSize: "0.72rem",
                        fontWeight: 600,
                        padding: "2px 6px",
                        borderRadius: "4px",
                        background: item.is_active ? "#dcfce7" : "#f1f5f9",
                        color: item.is_active ? "#15803d" : "#64748b",
                      }}
                    >
                      {item.is_active ? "Active" : "Inactive"}
                    </span>
                  </div>

                  {/* Title */}
                  <h4 style={{ margin: "2px 0 0 0", fontSize: "1.05rem", color: "#0f172a" }}>
                    {item.title}
                  </h4>

                  {/* Location & Address */}
                  {(item.location_name || item.address) && (
                    <div style={{ fontSize: "0.82rem", color: "#475569" }}>
                      {item.location_name && (
                        <div style={{ fontWeight: 600, color: "#1e293b" }}>
                          📍 {item.location_name}
                        </div>
                      )}
                      {item.address && <div style={{ color: "#64748b" }}>{item.address}</div>}
                    </div>
                  )}

                  {/* Directions Link */}
                  {item.directions_url && (
                    <div>
                      <a
                        href={item.directions_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          fontSize: "0.8rem",
                          fontWeight: 600,
                          color: "#0284c7",
                          textDecoration: "underline",
                        }}
                      >
                        🗺️ Directions
                      </a>
                    </div>
                  )}

                  {/* Booking Notes */}
                  {item.booking_notes && (
                    <div
                      style={{
                        fontSize: "0.8rem",
                        color: "#334155",
                        background: "#f8fafc",
                        border: "1px solid #e2e8f0",
                        borderRadius: "6px",
                        padding: "8px 10px",
                        lineHeight: 1.4,
                      }}
                    >
                      <strong>Booking Notes:</strong> {item.booking_notes}
                    </div>
                  )}

                  {/* Action buttons */}
                  <div
                    style={{
                      display: "flex",
                      gap: "8px",
                      justifyContent: "flex-end",
                      marginTop: "auto",
                      paddingTop: "10px",
                      borderTop: "1px solid #f1f5f9",
                    }}
                  >
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
                        background: item.is_active ? "#fff1f2" : "#f0fdf4",
                        color: item.is_active ? "#be123c" : "#15803d",
                        border: "1px solid transparent",
                        borderRadius: "6px",
                        cursor: "pointer",
                      }}
                      onClick={() => void toggleActive(item)}
                    >
                      {item.is_active ? "Deactivate" : "Reactivate"}
                    </button>
                    <button
                      type="button"
                      style={{
                        fontSize: "0.8rem",
                        padding: "4px 10px",
                        background: "#fff1f2",
                        color: "#e11d48",
                        border: "1px solid #fecdd3",
                        borderRadius: "6px",
                        cursor: "pointer",
                      }}
                      onClick={() => openDeleteModal(item)}
                    >
                      🗑️ Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ADD / EDIT MODAL */}
      {formModalOpen && (
        <div className="modal-backdrop">
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-label={editingItem ? "Edit Activity Template" : "Add Activity Template"}
            style={{ maxWidth: "520px", width: "95%" }}
          >
            <h3>{editingItem ? "Edit Activity Template" : "Add Activity Template"}</h3>
            {error && (
              <p className="form-error" role="alert" style={{ marginBottom: "12px" }}>
                {error}
              </p>
            )}

            <form
              onSubmit={handleSave}
              className="form-vertical"
              style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "12px" }}
            >
              <label>
                Activity Title *
                <input
                  type="text"
                  required
                  minLength={1}
                  maxLength={200}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. GoCar Tour Monterey, Slough Kayaking"
                />
              </label>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                <label>
                  Category *
                  <select value={category} onChange={(e) => setCategory(e.target.value)}>
                    <option value="tour">🗺️ Tour</option>
                    <option value="water">🛶 Water</option>
                    <option value="outdoor">🏔️ Outdoor</option>
                    <option value="entertainment">🎪 Entertainment</option>
                    <option value="other">🎯 Other</option>
                  </select>
                </label>

                <label>
                  Unit Label *
                  <input
                    type="text"
                    required
                    maxLength={50}
                    value={unitLabel}
                    onChange={(e) => setUnitLabel(e.target.value)}
                    placeholder="e.g. GoCar, Kayak, ATV, Raft"
                  />
                </label>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                <label>
                  Unit Capacity *
                  <input
                    type="number"
                    required
                    min={1}
                    max={50}
                    value={unitCapacity}
                    onChange={(e) => setUnitCapacity(e.target.value)}
                    placeholder="e.g. 2"
                  />
                </label>

                <label>
                  Location Name
                  <input
                    type="text"
                    maxLength={200}
                    value={locationName}
                    onChange={(e) => setLocationName(e.target.value)}
                    placeholder="e.g. Cannery Row Rentals"
                  />
                </label>
              </div>

              <label>
                Image URL
                <input
                  type="url"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder="https://images.unsplash.com/..."
                />
              </label>

              {/* Real-time image preview */}
              {imageUrl.trim() ? (
                <div
                  style={{
                    height: "120px",
                    borderRadius: "6px",
                    overflow: "hidden",
                    background: "#f1f5f9",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: "1px solid #cbd5e1",
                  }}
                >
                  <img
                    src={imageUrl.trim()}
                    alt="Image preview"
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    onError={(e) => {
                      (e.currentTarget as HTMLElement).style.display = "none";
                    }}
                  />
                </div>
              ) : null}

              <label>
                Physical Address
                <input
                  type="text"
                  maxLength={500}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="e.g. 700 Cannery Row, Monterey, CA"
                />
              </label>

              <label>
                Directions / Map URL
                <input
                  type="url"
                  value={directionsUrl}
                  onChange={(e) => setDirectionsUrl(e.target.value)}
                  placeholder="https://maps.google.com/?q=..."
                />
              </label>

              <label>
                Booking Notes
                <textarea
                  rows={3}
                  maxLength={2000}
                  value={bookingNotes}
                  onChange={(e) => setBookingNotes(e.target.value)}
                  placeholder="Groupon tips, voucher redemption steps, waiver links, driver requirements..."
                />
              </label>

              <div
                className="modal-actions"
                style={{ display: "flex", gap: "10px", justifyContent: "flex-end", marginTop: "12px" }}
              >
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setFormModalOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={saving}>
                  {saving ? "Saving…" : "Save Template"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PERMANENT DELETE CONFIRMATION MODAL */}
      {deleteModalOpen && deletingItem && (
        <div className="modal-backdrop">
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-label="Delete Activity Template"
            style={{ maxWidth: "460px" }}
          >
            <h3 style={{ color: "#be123c", margin: "0 0 10px 0" }}>🗑️ Delete Activity Template</h3>
            <p style={{ margin: "0 0 12px 0", color: "#1e293b", fontWeight: 500 }}>
              Are you sure you want to delete <strong>&ldquo;{deletingItem.title}&rdquo;</strong>?
            </p>

            <div
              style={{
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: "8px",
                padding: "12px",
                fontSize: "0.85rem",
                color: "#475569",
                marginBottom: "16px",
              }}
            >
              <strong>🛡️ Safe Template Deletion:</strong>
              <p style={{ margin: "6px 0 0 0" }}>
                Deleting this master template safely removes it from future trip activity selection.
                Any existing trips that previously cloned or scheduled this activity will retain their scheduled events and pairings intact.
              </p>
            </div>

            {error && (
              <p className="form-error" role="alert" style={{ marginBottom: "12px" }}>
                {error}
              </p>
            )}

            <div className="modal-actions" style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn-secondary"
                disabled={deleting}
                onClick={() => {
                  setDeleteModalOpen(false);
                  setDeletingItem(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                style={{
                  minHeight: "44px",
                  padding: "0.55rem 1.1rem",
                  background: "#e11d48",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "8px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
                disabled={deleting}
                onClick={() => void handleConfirmDelete()}
              >
                {deleting ? "Deleting…" : "Confirm Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
