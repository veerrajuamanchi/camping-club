import { useEffect, useState } from "react";
import { Link } from "react-router";
import { invokeTripApi, TripApiError } from "../../lib/supabase";
import type { TripApi } from "../trips/TripCalendarPage";
import { MasterActivitiesTab, type MasterActivityItem } from "./MasterActivitiesTab";

const defaultApi: TripApi = (action, input, key) => invokeTripApi(action, input, key);

export type GearType = "individual" | "shared";

export type GearCategory =
  | "shelter"
  | "sleep"
  | "kitchen"
  | "lighting"
  | "safety"
  | "tools"
  | "clothing"
  | "other";

export type FoodCategory =
  | "pantry"
  | "produce"
  | "dairy_meat"
  | "bakery"
  | "beverages"
  | "campfire"
  | "supplies"
  | "other";

export type ResponsibilityCategory =
  | "meal_prep"
  | "cooking"
  | "cleanup"
  | "activities"
  | "transport"
  | "other";

export interface MasterGearItem {
  id: string;
  name: string;
  description: string | null;
  gear_type: GearType;
  category: GearCategory;
  default_quantity: string;
  is_critical: boolean;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface MasterFoodItem {
  id: string;
  name: string;
  description: string | null;
  category: FoodCategory;
  default_quantity: string;
  is_critical: boolean;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface MasterResponsibilityItem {
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

export interface MasterCatalogsData {
  gear: MasterGearItem[];
  food: MasterFoodItem[];
  responsibilities: MasterResponsibilityItem[];
  activities?: MasterActivityItem[];
}

export const GEAR_CATEGORY_LABELS: Record<GearCategory, { label: string; icon: string }> = {
  shelter: { label: "Shelter & Tents", icon: "⛺" },
  sleep: { label: "Sleeping & Bedding", icon: "🛏️" },
  kitchen: { label: "Kitchen & Cooking", icon: "🍳" },
  lighting: { label: "Lighting & Power", icon: "🔦" },
  safety: { label: "Safety & First Aid", icon: "🩹" },
  tools: { label: "Tools & Utilities", icon: "🔧" },
  clothing: { label: "Clothing & Weather", icon: "👕" },
  other: { label: "Other / Misc", icon: "📦" },
};

export const FOOD_CATEGORY_LABELS: Record<FoodCategory, { label: string; icon: string }> = {
  pantry: { label: "Pantry Staples", icon: "🌾" },
  produce: { label: "Produce & Fresh", icon: "🥬" },
  dairy_meat: { label: "Dairy & Meat", icon: "🥩" },
  bakery: { label: "Bakery & Breads", icon: "🍞" },
  beverages: { label: "Beverages", icon: "🧃" },
  campfire: { label: "Campfire & S'mores", icon: "🔥" },
  supplies: { label: "Paper & Supplies", icon: "🧻" },
  other: { label: "Other Grocery", icon: "📦" },
};

export const RESP_CATEGORY_LABELS: Record<ResponsibilityCategory, { label: string; icon: string }> = {
  meal_prep: { label: "Meal Prep", icon: "🥗" },
  cooking: { label: "Cooking", icon: "🍳" },
  cleanup: { label: "Cleanup", icon: "🧹" },
  transport: { label: "Transport & Driving", icon: "🚗" },
  activities: { label: "Activities & Games", icon: "🎯" },
  other: { label: "General & Campfire", icon: "🪵" },
};

type CatalogTab = "gear" | "food" | "responsibilities" | "activities";
type GearFilter = "all" | "individual" | "shared";

export function MasterCatalogPage({ api = defaultApi }: { api?: TripApi }) {
  const [data, setData] = useState<MasterCatalogsData>({
    gear: [],
    food: [],
    responsibilities: [],
    activities: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Tab & Filters
  const [activeTab, setActiveTab] = useState<CatalogTab>("gear");
  const [gearFilter, setGearFilter] = useState<GearFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showInactive, setShowInactive] = useState(true);

  // Modal State for Add / Edit
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<
    | { type: "gear"; item: MasterGearItem }
    | { type: "food"; item: MasterFoodItem }
    | { type: "responsibilities"; item: MasterResponsibilityItem }
    | null
  >(null);
  const [saving, setSaving] = useState(false);

  // Modal State for Delete
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deletingItem, setDeletingItem] = useState<{
    type: "gear" | "food" | "responsibilities";
    id: string;
    name: string;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Form Fields - Gear
  const [gearName, setGearName] = useState("");
  const [gearType, setGearType] = useState<GearType>("individual");
  const [gearCategory, setGearCategory] = useState<GearCategory>("shelter");
  const [gearDefaultQuantity, setGearDefaultQuantity] = useState("1");
  const [gearIsCritical, setGearIsCritical] = useState(false);
  const [gearDescription, setGearDescription] = useState("");

  // Form Fields - Food
  const [foodName, setFoodName] = useState("");
  const [foodCategory, setFoodCategory] = useState<FoodCategory>("pantry");
  const [foodDefaultQuantity, setFoodDefaultQuantity] = useState("1 pack");
  const [foodIsCritical, setFoodIsCritical] = useState(false);
  const [foodDescription, setFoodDescription] = useState("");

  // Form Fields - Responsibility
  const [respTitle, setRespTitle] = useState("");
  const [respCategory, setRespCategory] = useState<ResponsibilityCategory>("meal_prep");
  const [respDefaultCapacity, setRespDefaultCapacity] = useState("1");
  const [respWorkloadWeight, setRespWorkloadWeight] = useState("1.0");
  const [respDescription, setRespDescription] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api<MasterCatalogsData>("get_master_catalogs", { includeInactive: true });
      setData({
        gear: res.gear ?? [],
        food: res.food ?? [],
        responsibilities: res.responsibilities ?? [],
        activities: res.activities ?? [],
      });
    } catch {
      setError("Could not load master catalogs. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function openAddModal() {
    setError(null);
    setEditingItem(null);
    if (activeTab === "gear") {
      setGearName("");
      setGearType(gearFilter === "shared" ? "shared" : "individual");
      setGearCategory("shelter");
      setGearDefaultQuantity("1");
      setGearIsCritical(false);
      setGearDescription("");
    } else if (activeTab === "food") {
      setFoodName("");
      setFoodCategory("pantry");
      setFoodDefaultQuantity("1 pack");
      setFoodIsCritical(false);
      setFoodDescription("");
    } else {
      setRespTitle("");
      setRespCategory("meal_prep");
      setRespDefaultCapacity("1");
      setRespWorkloadWeight("1.0");
      setRespDescription("");
    }
    setFormModalOpen(true);
  }

  function openEditGearModal(item: MasterGearItem) {
    setError(null);
    setEditingItem({ type: "gear", item });
    setGearName(item.name);
    setGearType(item.gear_type);
    setGearCategory(item.category);
    setGearDefaultQuantity(item.default_quantity || "1");
    setGearIsCritical(item.is_critical);
    setGearDescription(item.description ?? "");
    setFormModalOpen(true);
  }

  function openEditFoodModal(item: MasterFoodItem) {
    setError(null);
    setEditingItem({ type: "food", item });
    setFoodName(item.name);
    setFoodCategory(item.category);
    setFoodDefaultQuantity(item.default_quantity || "1 pack");
    setFoodIsCritical(item.is_critical);
    setFoodDescription(item.description ?? "");
    setFormModalOpen(true);
  }

  function openEditRespModal(item: MasterResponsibilityItem) {
    setError(null);
    setEditingItem({ type: "responsibilities", item });
    setRespTitle(item.title);
    setRespCategory(item.category);
    setRespDefaultCapacity(String(item.default_capacity));
    setRespWorkloadWeight(String(item.workload_weight));
    setRespDescription(item.description ?? "");
    setFormModalOpen(true);
  }

  function openDeleteModal(type: "gear" | "food" | "responsibilities", id: string, name: string) {
    setError(null);
    setDeletingItem({ type, id, name });
    setDeleteModalOpen(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      if (activeTab === "gear") {
        const cleanName = gearName.trim();
        if (cleanName.length < 2 || cleanName.length > 100) {
          setError("Gear item name must be between 2 and 100 characters.");
          setSaving(false);
          return;
        }
        if (editingItem && editingItem.type === "gear") {
          await api("admin_manage_master_gear", {
            action: "update",
            id: editingItem.item.id,
            name: cleanName,
            gearType,
            category: gearCategory,
            defaultQuantity: gearDefaultQuantity.trim() || "1",
            isCritical: gearIsCritical,
            description: gearDescription.trim() || null,
          });
        } else {
          await api("admin_manage_master_gear", {
            action: "create",
            name: cleanName,
            gearType,
            category: gearCategory,
            defaultQuantity: gearDefaultQuantity.trim() || "1",
            isCritical: gearIsCritical,
            description: gearDescription.trim() || null,
          });
        }
      } else if (activeTab === "food") {
        const cleanName = foodName.trim();
        if (cleanName.length < 2 || cleanName.length > 100) {
          setError("Grocery item name must be between 2 and 100 characters.");
          setSaving(false);
          return;
        }
        if (editingItem && editingItem.type === "food") {
          await api("admin_manage_master_food", {
            action: "update",
            id: editingItem.item.id,
            name: cleanName,
            category: foodCategory,
            defaultQuantity: foodDefaultQuantity.trim() || "1 pack",
            isCritical: foodIsCritical,
            description: foodDescription.trim() || null,
          });
        } else {
          await api("admin_manage_master_food", {
            action: "create",
            name: cleanName,
            category: foodCategory,
            defaultQuantity: foodDefaultQuantity.trim() || "1 pack",
            isCritical: foodIsCritical,
            description: foodDescription.trim() || null,
          });
        }
      } else {
        const cleanTitle = respTitle.trim();
        if (cleanTitle.length < 3 || cleanTitle.length > 100) {
          setError("Responsibility title must be between 3 and 100 characters.");
          setSaving(false);
          return;
        }
        const cap = Number(respDefaultCapacity);
        if (!Number.isInteger(cap) || cap < 1 || cap > 20) {
          setError("Default capacity must be an integer between 1 and 20.");
          setSaving(false);
          return;
        }
        const weight = Number(respWorkloadWeight);
        if (isNaN(weight) || weight < 0.5 || weight > 5.0) {
          setError("Workload weight must be between 0.5 and 5.0.");
          setSaving(false);
          return;
        }

        if (editingItem && editingItem.type === "responsibilities") {
          await api("admin_update_master_responsibility", {
            id: editingItem.item.id,
            title: cleanTitle,
            description: respDescription.trim() || null,
            category: respCategory,
            defaultCapacity: cap,
            workloadWeight: weight,
            active: editingItem.item.active,
          });
        } else {
          await api("admin_create_master_responsibility", {
            title: cleanTitle,
            description: respDescription.trim() || null,
            category: respCategory,
            defaultCapacity: cap,
            workloadWeight: weight,
          });
        }
      }

      setFormModalOpen(false);
      await load();
    } catch (err) {
      if (err instanceof TripApiError) {
        setError(err.message || "Failed to save master template.");
      } else {
        setError((err as any)?.message || "Failed to save template. Please try again.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmDelete() {
    if (!deletingItem) return;
    setDeleting(true);
    setError(null);

    try {
      if (deletingItem.type === "gear") {
        await api("admin_manage_master_gear", {
          action: "delete",
          id: deletingItem.id,
        });
      } else if (deletingItem.type === "food") {
        await api("admin_manage_master_food", {
          action: "delete",
          id: deletingItem.id,
        });
      } else {
        await api("admin_delete_master_responsibility", {
          id: deletingItem.id,
        });
      }

      setDeleteModalOpen(false);
      setDeletingItem(null);
      await load();
    } catch (err) {
      if (err instanceof TripApiError) {
        setError(err.message || "Could not delete template.");
      } else {
        setError((err as any)?.message || "Could not delete template.");
      }
    } finally {
      setDeleting(false);
    }
  }

  async function toggleGearActive(item: MasterGearItem) {
    setError(null);
    try {
      await api("admin_manage_master_gear", {
        action: "update",
        id: item.id,
        active: !item.active,
      });
      await load();
    } catch {
      setError("Could not update item status.");
    }
  }

  async function toggleFoodActive(item: MasterFoodItem) {
    setError(null);
    try {
      await api("admin_manage_master_food", {
        action: "update",
        id: item.id,
        active: !item.active,
      });
      await load();
    } catch {
      setError("Could not update item status.");
    }
  }

  async function toggleRespActive(item: MasterResponsibilityItem) {
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

  // Filtered lists
  const cleanQuery = searchQuery.trim().toLowerCase();

  const filteredGear = data.gear.filter((item) => {
    if (!showInactive && !item.active) return false;
    if (gearFilter !== "all" && item.gear_type !== gearFilter) return false;
    if (cleanQuery) {
      const matchName = item.name.toLowerCase().includes(cleanQuery);
      const matchDesc = item.description?.toLowerCase().includes(cleanQuery) ?? false;
      const matchCat = item.category.toLowerCase().includes(cleanQuery);
      if (!matchName && !matchDesc && !matchCat) return false;
    }
    return true;
  });

  const filteredFood = data.food.filter((item) => {
    if (!showInactive && !item.active) return false;
    if (cleanQuery) {
      const matchName = item.name.toLowerCase().includes(cleanQuery);
      const matchDesc = item.description?.toLowerCase().includes(cleanQuery) ?? false;
      const matchCat = item.category.toLowerCase().includes(cleanQuery);
      if (!matchName && !matchDesc && !matchCat) return false;
    }
    return true;
  });

  const filteredResp = data.responsibilities.filter((item) => {
    if (!showInactive && !item.active) return false;
    if (cleanQuery) {
      const matchTitle = item.title.toLowerCase().includes(cleanQuery);
      const matchDesc = item.description?.toLowerCase().includes(cleanQuery) ?? false;
      const matchCat = item.category.toLowerCase().includes(cleanQuery);
      if (!matchTitle && !matchDesc && !matchCat) return false;
    }
    return true;
  });

  return (
    <section className="admin-page" aria-label="Master Catalogs">
      <div className="admin-header-row" style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", marginBottom: "1rem" }}>
        <div>
          <Link to="/" className="back-link">
            ← Back to Trips
          </Link>
          <h2 style={{ margin: "0.25rem 0" }}>📦 Master Catalogs Directory</h2>
          <p className="admin-subtitle" style={{ color: "#64748b", margin: 0, fontSize: "0.9rem" }}>
            Reusable templates for Camping Gear, Food & Groceries, Responsibilities, and Activities. All active items are automatically seeded into newly created trips.
          </p>
        </div>
        {activeTab !== "activities" && (
          <button type="button" className="btn-primary" onClick={openAddModal}>
            + Add {activeTab === "gear" ? "Gear" : activeTab === "food" ? "Grocery Item" : "Responsibility"}
          </button>
        )}
      </div>

      {error && <p className="form-error" role="alert" style={{ marginBottom: "1rem" }}>{error}</p>}

      {/* Tabs navigation */}
      <div className="event-tabs" role="tablist" aria-label="Master Catalogs Tabs" style={{ marginBottom: "1.25rem" }}>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "gear"}
          className={activeTab === "gear" ? "active" : ""}
          onClick={() => {
            setActiveTab("gear");
            setSearchQuery("");
          }}
        >
          🎒 Camping Gear ({data.gear.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "food"}
          className={activeTab === "food" ? "active" : ""}
          onClick={() => {
            setActiveTab("food");
            setSearchQuery("");
          }}
        >
          🍎 Food & Groceries ({data.food.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "responsibilities"}
          className={activeTab === "responsibilities" ? "active" : ""}
          onClick={() => {
            setActiveTab("responsibilities");
            setSearchQuery("");
          }}
        >
          🛠️ Responsibilities ({data.responsibilities.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "activities"}
          className={activeTab === "activities" ? "active" : ""}
          onClick={() => {
            setActiveTab("activities");
            setSearchQuery("");
          }}
        >
          🎯 Activities ({(data.activities ?? []).length})
        </button>
      </div>

      {/* Controls Bar: Search & Sub-filters */}
      {activeTab !== "activities" && (
        <div className="filter-bar" style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center", marginBottom: "1.25rem" }}>
          <div style={{ flex: "1 1 240px", minWidth: "200px" }}>
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={`Search ${activeTab === "gear" ? "camping gear" : activeTab === "food" ? "food & groceries" : "responsibilities"}…`}
              style={{ width: "100%", padding: "0.55rem 0.85rem", borderRadius: "8px", border: "1px solid #cbd5e1" }}
              aria-label="Search items"
            />
          </div>

          {/* Instant Filter Pills for Camping Gear */}
          {activeTab === "gear" && (
            <div className="rsvp-pills" style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              <button
                type="button"
                className={`rsvp-pill-btn ${gearFilter === "all" ? "active" : ""}`}
                onClick={() => setGearFilter("all")}
              >
                All ({data.gear.length})
              </button>
              <button
                type="button"
                className={`rsvp-pill-btn ${gearFilter === "individual" ? "active" : ""}`}
                onClick={() => setGearFilter("individual")}
              >
                🎒 Individual ({data.gear.filter((g) => g.gear_type === "individual").length})
              </button>
              <button
                type="button"
                className={`rsvp-pill-btn ${gearFilter === "shared" ? "active" : ""}`}
                onClick={() => setGearFilter("shared")}
              >
                ⛺ Shared ({data.gear.filter((g) => g.gear_type === "shared").length})
              </button>
            </div>
          )}

          <label style={{ marginLeft: "auto", fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", minHeight: "44px" }}>
            <input
              type="checkbox"
              style={{ width: "18px", height: "18px" }}
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />
            <span>Show inactive / retired</span>
          </label>
        </div>
      )}

      {loading ? (
        <p role="status">Loading master catalogs…</p>
      ) : (
        <>
          {/* TAB 1: CAMPING GEAR */}
          {activeTab === "gear" && (
            <div className="catalog-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 320px), 1fr))", gap: "16px" }}>
              {filteredGear.map((item) => (
                <div
                  key={item.id}
                  className="event-card"
                  style={{
                    padding: "16px",
                    borderRadius: "10px",
                    border: item.active ? "1px solid #e2e8f0" : "1px dashed #cbd5e1",
                    background: item.active ? "#ffffff" : "#f8fafc",
                    opacity: item.active ? 1 : 0.75,
                  }}
                >
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
                    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                      <span
                        style={{
                          fontSize: "0.75rem",
                          fontWeight: 600,
                          padding: "3px 8px",
                          borderRadius: "6px",
                          background: item.gear_type === "shared" ? "#fef3c7" : "#e0f2fe",
                          color: item.gear_type === "shared" ? "#92400e" : "#0369a1",
                        }}
                      >
                        {item.gear_type === "shared" ? "⛺ Shared" : "🎒 Individual"}
                      </span>
                      <span
                        style={{
                          fontSize: "0.75rem",
                          fontWeight: 500,
                          padding: "3px 8px",
                          borderRadius: "6px",
                          background: "#f1f5f9",
                          color: "#475569",
                        }}
                      >
                        {GEAR_CATEGORY_LABELS[item.category]?.icon ?? "📦"} {GEAR_CATEGORY_LABELS[item.category]?.label ?? item.category}
                      </span>
                      {item.is_critical && (
                        <span
                          style={{
                            fontSize: "0.72rem",
                            fontWeight: 600,
                            padding: "3px 6px",
                            borderRadius: "6px",
                            background: "#fee2e2",
                            color: "#b91c1c",
                          }}
                        >
                          ⭐ Critical
                        </span>
                      )}
                    </div>
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
                      {item.active ? "Active" : "Inactive"}
                    </span>
                  </div>

                  <h3 style={{ fontSize: "1.05rem", margin: "4px 0 6px 0", color: "#0f172a" }}>{item.name}</h3>
                  {item.description && (
                    <p style={{ fontSize: "0.85rem", color: "#64748b", margin: "0 0 10px 0" }}>{item.description}</p>
                  )}
                  <p style={{ fontSize: "0.8rem", color: "#475569", margin: "0 0 12px 0" }}>
                    Default quantity: <strong>{item.default_quantity || "1"}</strong>
                  </p>

                  <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", borderTop: "1px solid #f1f5f9", paddingTop: "8px" }}>
                    <button
                      type="button"
                      className="btn-secondary"
                      style={{ fontSize: "0.8rem", padding: "4px 10px" }}
                      onClick={() => openEditGearModal(item)}
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
                      onClick={() => void toggleGearActive(item)}
                    >
                      {item.active ? "Retire" : "Reactivate"}
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
                      onClick={() => openDeleteModal("gear", item.id, item.name)}
                    >
                      🗑️ Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* TAB 2: FOOD & GROCERIES */}
          {activeTab === "food" && (
            <div className="catalog-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 320px), 1fr))", gap: "16px" }}>
              {filteredFood.map((item) => (
                <div
                  key={item.id}
                  className="event-card"
                  style={{
                    padding: "16px",
                    borderRadius: "10px",
                    border: item.active ? "1px solid #e2e8f0" : "1px dashed #cbd5e1",
                    background: item.active ? "#ffffff" : "#f8fafc",
                    opacity: item.active ? 1 : 0.75,
                  }}
                >
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
                    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                      <span
                        style={{
                          fontSize: "0.75rem",
                          fontWeight: 500,
                          padding: "3px 8px",
                          borderRadius: "6px",
                          background: "#f1f5f9",
                          color: "#475569",
                        }}
                      >
                        {FOOD_CATEGORY_LABELS[item.category]?.icon ?? "🍎"} {FOOD_CATEGORY_LABELS[item.category]?.label ?? item.category}
                      </span>
                      {item.is_critical && (
                        <span
                          style={{
                            fontSize: "0.72rem",
                            fontWeight: 600,
                            padding: "3px 6px",
                            borderRadius: "6px",
                            background: "#fee2e2",
                            color: "#b91c1c",
                          }}
                        >
                          ⭐ Critical
                        </span>
                      )}
                    </div>
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
                      {item.active ? "Active" : "Inactive"}
                    </span>
                  </div>

                  <h3 style={{ fontSize: "1.05rem", margin: "4px 0 6px 0", color: "#0f172a" }}>{item.name}</h3>
                  {item.description && (
                    <p style={{ fontSize: "0.85rem", color: "#64748b", margin: "0 0 10px 0" }}>{item.description}</p>
                  )}
                  <p style={{ fontSize: "0.8rem", color: "#475569", margin: "0 0 12px 0" }}>
                    Default quantity: <strong>{item.default_quantity || "1 pack"}</strong>
                  </p>

                  <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", borderTop: "1px solid #f1f5f9", paddingTop: "8px" }}>
                    <button
                      type="button"
                      className="btn-secondary"
                      style={{ fontSize: "0.8rem", padding: "4px 10px" }}
                      onClick={() => openEditFoodModal(item)}
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
                      onClick={() => void toggleFoodActive(item)}
                    >
                      {item.active ? "Retire" : "Reactivate"}
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
                      onClick={() => openDeleteModal("food", item.id, item.name)}
                    >
                      🗑️ Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* TAB 3: RESPONSIBILITIES */}
          {activeTab === "responsibilities" && (
            <div className="catalog-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 320px), 1fr))", gap: "16px" }}>
              {filteredResp.map((item) => (
                <div
                  key={item.id}
                  className="event-card"
                  style={{
                    padding: "16px",
                    borderRadius: "10px",
                    border: item.active ? "1px solid #e2e8f0" : "1px dashed #cbd5e1",
                    background: item.active ? "#ffffff" : "#f8fafc",
                    opacity: item.active ? 1 : 0.75,
                  }}
                >
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
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
                      {RESP_CATEGORY_LABELS[item.category]?.icon ?? "📌"} {RESP_CATEGORY_LABELS[item.category]?.label ?? item.category}
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
                    <p style={{ fontSize: "0.85rem", color: "#64748b", margin: "0 0 10px 0" }}>{item.description}</p>
                  )}
                  <div style={{ display: "flex", gap: "12px", fontSize: "0.8rem", color: "#475569", margin: "0 0 12px 0" }}>
                    <div>👥 <strong>{item.default_capacity} volunteers</strong></div>
                    <div>⚖️ <strong>{Number(item.workload_weight).toFixed(1)}x weight</strong></div>
                  </div>

                  <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", borderTop: "1px solid #f1f5f9", paddingTop: "8px" }}>
                    <button
                      type="button"
                      className="btn-secondary"
                      style={{ fontSize: "0.8rem", padding: "4px 10px" }}
                      onClick={() => openEditRespModal(item)}
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
                      onClick={() => void toggleRespActive(item)}
                    >
                      {item.active ? "Retire" : "Reactivate"}
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
                      onClick={() => openDeleteModal("responsibilities", item.id, item.title)}
                    >
                      🗑️ Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* TAB 4: ACTIVITIES */}
          {activeTab === "activities" && (
            <MasterActivitiesTab
              api={api}
              activities={data.activities}
              onRefresh={load}
            />
          )}

          {((activeTab === "gear" && filteredGear.length === 0) ||
            (activeTab === "food" && filteredFood.length === 0) ||
            (activeTab === "responsibilities" && filteredResp.length === 0)) && (
            <p style={{ textAlign: "center", color: "#94a3b8", padding: "40px 0" }}>
              No master catalog items match your filter criteria.
            </p>
          )}
        </>
      )}

      {/* ADD / EDIT MODAL */}
      {formModalOpen && (
        <div className="modal-backdrop">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label={
            activeTab === "gear"
              ? editingItem ? "Edit Master Gear" : "Add Master Gear"
              : activeTab === "food"
              ? editingItem ? "Edit Master Food" : "Add Master Grocery Item"
              : editingItem ? "Edit Master Responsibility" : "Add Master Responsibility"
          } style={{ maxWidth: "500px" }}>
            <h3>
              {activeTab === "gear"
                ? editingItem ? "Edit Master Gear" : "Add Master Gear"
                : activeTab === "food"
                ? editingItem ? "Edit Master Food" : "Add Master Grocery Item"
                : editingItem ? "Edit Master Responsibility" : "Add Master Responsibility"}
            </h3>
            {error && <p className="form-error" role="alert" style={{ marginBottom: "12px" }}>{error}</p>}

            <form onSubmit={handleSave} className="form-vertical" style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "12px" }}>
              {/* Form fields for Gear */}
              {activeTab === "gear" && (
                <>
                  <label>
                    Item Name *
                    <input
                      type="text"
                      required
                      minLength={2}
                      maxLength={100}
                      value={gearName}
                      onChange={(e) => setGearName(e.target.value)}
                      placeholder="e.g. 4-Person Tent, Sleeping Bag"
                    />
                  </label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                    <label>
                      Gear Type *
                      <select value={gearType} onChange={(e) => setGearType(e.target.value as GearType)}>
                        <option value="individual">🎒 Individual Packing</option>
                        <option value="shared">⛺ Shared Community Gear</option>
                      </select>
                    </label>
                    <label>
                      Category *
                      <select value={gearCategory} onChange={(e) => setGearCategory(e.target.value as GearCategory)}>
                        {Object.keys(GEAR_CATEGORY_LABELS).map((cat) => (
                          <option key={cat} value={cat}>
                            {GEAR_CATEGORY_LABELS[cat as GearCategory].icon} {GEAR_CATEGORY_LABELS[cat as GearCategory].label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                    <label>
                      Default Quantity
                      <input
                        type="text"
                        value={gearDefaultQuantity}
                        onChange={(e) => setGearDefaultQuantity(e.target.value)}
                        placeholder="e.g. 1, 2"
                      />
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "1.2rem", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={gearIsCritical}
                        onChange={(e) => setGearIsCritical(e.target.checked)}
                        style={{ width: "18px", height: "18px" }}
                      />
                      <span>⭐ Critical Item</span>
                    </label>
                  </div>
                  <label>
                    Description
                    <textarea
                      rows={3}
                      maxLength={500}
                      value={gearDescription}
                      onChange={(e) => setGearDescription(e.target.value)}
                      placeholder="Usage instructions, sizing, or notes..."
                    />
                  </label>
                </>
              )}

              {/* Form fields for Food */}
              {activeTab === "food" && (
                <>
                  <label>
                    Item Name *
                    <input
                      type="text"
                      required
                      minLength={2}
                      maxLength={100}
                      value={foodName}
                      onChange={(e) => setFoodName(e.target.value)}
                      placeholder="e.g. Pancake Mix, Cooking Oil"
                    />
                  </label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                    <label>
                      Category *
                      <select value={foodCategory} onChange={(e) => setFoodCategory(e.target.value as FoodCategory)}>
                        {Object.keys(FOOD_CATEGORY_LABELS).map((cat) => (
                          <option key={cat} value={cat}>
                            {FOOD_CATEGORY_LABELS[cat as FoodCategory].icon} {FOOD_CATEGORY_LABELS[cat as FoodCategory].label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Default Quantity
                      <input
                        type="text"
                        value={foodDefaultQuantity}
                        onChange={(e) => setFoodDefaultQuantity(e.target.value)}
                        placeholder="e.g. 1 pack, 2 cartons"
                      />
                    </label>
                  </div>
                  <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={foodIsCritical}
                      onChange={(e) => setFoodIsCritical(e.target.checked)}
                      style={{ width: "18px", height: "18px" }}
                    />
                    <span>⭐ Critical Item</span>
                  </label>
                  <label>
                    Description
                    <textarea
                      rows={3}
                      maxLength={500}
                      value={foodDescription}
                      onChange={(e) => setFoodDescription(e.target.value)}
                      placeholder="Brand preferences, dietary notes..."
                    />
                  </label>
                </>
              )}

              {/* Form fields for Responsibilities */}
              {activeTab === "responsibilities" && (
                <>
                  <label>
                    Title *
                    <input
                      type="text"
                      required
                      minLength={3}
                      maxLength={100}
                      value={respTitle}
                      onChange={(e) => setRespTitle(e.target.value)}
                      placeholder="e.g. Campfire Setup, Dinner Cook"
                    />
                  </label>
                  <label>
                    Category *
                    <select value={respCategory} onChange={(e) => setRespCategory(e.target.value as ResponsibilityCategory)}>
                      {Object.keys(RESP_CATEGORY_LABELS).map((cat) => (
                        <option key={cat} value={cat}>
                          {RESP_CATEGORY_LABELS[cat as ResponsibilityCategory].icon} {RESP_CATEGORY_LABELS[cat as ResponsibilityCategory].label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                    <label>
                      Default Capacity *
                      <input
                        type="number"
                        required
                        min={1}
                        max={20}
                        value={respDefaultCapacity}
                        onChange={(e) => setRespDefaultCapacity(e.target.value)}
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
                        value={respWorkloadWeight}
                        onChange={(e) => setRespWorkloadWeight(e.target.value)}
                      />
                    </label>
                  </div>
                  <label>
                    Description
                    <textarea
                      rows={3}
                      maxLength={500}
                      value={respDescription}
                      onChange={(e) => setRespDescription(e.target.value)}
                      placeholder="Duties, safety rules, schedule timing..."
                    />
                  </label>
                </>
              )}

              <div className="modal-actions" style={{ display: "flex", gap: "10px", justifyContent: "flex-end", marginTop: "12px" }}>
                <button type="button" className="btn-secondary" onClick={() => setFormModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={saving}>
                  {saving ? "Saving…" : "Save Item"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PERMANENT DELETE CONFIRMATION MODAL */}
      {deleteModalOpen && deletingItem && (
        <div className="modal-backdrop">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Delete Master Template" style={{ maxWidth: "460px" }}>
            <h3 style={{ color: "#be123c", margin: "0 0 10px 0" }}>🗑️ Delete Master Template</h3>
            <p style={{ margin: "0 0 12px 0", color: "#1e293b", fontWeight: 500 }}>
              Are you sure you want to permanently delete <strong>&ldquo;{deletingItem.name}&rdquo;</strong>?
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
              <strong>🛡️ Safe Unlinking Guarantee:</strong>
              <p style={{ margin: "6px 0 0 0" }}>
                {deletingItem.type === "responsibilities"
                  ? "This template will be permanently removed if unused. If it was previously assigned in historical trips, it will be safely retired instead of deleted to protect historical duty logs."
                  : "Deleting this master template safely removes it from future trip creation. Any existing or past trips will safely retain their snapshotted commitments."}
              </p>
            </div>

            {error && <p className="form-error" role="alert" style={{ marginBottom: "12px" }}>{error}</p>}

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
    </section>
  );
}
