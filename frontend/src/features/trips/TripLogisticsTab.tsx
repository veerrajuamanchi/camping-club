import React, { useEffect, useState } from "react";
import type { TripApiType } from "./EventDetailsPage";

export type CommitmentCategory =
  | "gear"
  | "food"
  | "supplies"
  | "shelter"
  | "safety"
  | "sleep"
  | "kitchen"
  | "lighting"
  | "tools"
  | "clothing"
  | "pantry"
  | "produce"
  | "dairy_meat"
  | "bakery"
  | "beverages"
  | "campfire"
  | "other";

export type TripCommitment = {
  id: string;
  tripId: string;
  category: CommitmentCategory;
  itemName: string;
  quantityDescription: string | null;
  assignedMemberId: string | null;
  assignedMemberName: string | null;
  isCritical: boolean;
  isMine: boolean;
  commitmentType?: "individual_pack" | "shared_volunteer";
  isActive?: boolean;
  masterGearId?: string | null;
  masterFoodId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TripCarpool = {
  id: string;
  tripId: string;
  driverMemberId: string;
  driverName: string;
  vehicleDescription: string;
  maxSeats: number;
  occupiedSeats: number;
  availableSeats: number;
  startingMileage: number | null;
  endingMileage: number | null;
  totalMiles: number | null;
  departureDetails: string | null;
  isMyCarpool: boolean;
  riders: Array<{
    id: string;
    riderMemberId: string;
    displayName: string;
    isMe: boolean;
  }>;
};

export type MemberReadiness = {
  carpoolRole: "driver" | "rider" | "unassigned";
  carpoolDetails: string | null;
  myCommitmentsCount: number;
  criticalMissingCount: number;
  totalCarpoolsCount: number;
};

type Props = {
  tripId: string;
  isConfirmedAttendee: boolean;
  isAdmin: boolean;
  currentMemberId?: string;
  confirmedAttendees?: Array<{ memberId: string; displayName: string }>;
  tripNotes?: string | null;
  reservationInstructions?: string | null;
  drivingDirections?: string | null;
  api: TripApiType;
  section?: "all" | "transportation" | "gear";
  onEditLogistics?: () => void;
  onOpenPackingChecklist?: () => void;
};

const CATEGORY_META: Record<CommitmentCategory, { label: string; icon: string }> = {
  gear: { label: "Cooking & Camp Gear", icon: "🍳" },
  food: { label: "Food & Ingredients", icon: "🍎" },
  supplies: { label: "Wood & Camp Supplies", icon: "🪵" },
  shelter: { label: "Tents & Canopies", icon: "⛺" },
  safety: { label: "First Aid & Safety", icon: "🩹" },
  sleep: { label: "Sleeping Gear", icon: "🛏️" },
  kitchen: { label: "Camp Kitchen", icon: "🍳" },
  lighting: { label: "Lighting & Lanterns", icon: "🔦" },
  tools: { label: "Tools & Equipment", icon: "🔨" },
  clothing: { label: "Clothing & Weather", icon: "🧥" },
  pantry: { label: "Pantry Staples", icon: "🥫" },
  produce: { label: "Produce & Fresh", icon: "🥗" },
  dairy_meat: { label: "Dairy & Meat", icon: "🥩" },
  bakery: { label: "Bakery & Breads", icon: "🍞" },
  beverages: { label: "Beverages & Drinks", icon: "☕" },
  campfire: { label: "Campfire & S'mores", icon: "🔥" },
  other: { label: "Other Supplies", icon: "📦" },
};

export function TripLogisticsTab({
  tripId,
  isConfirmedAttendee,
  isAdmin,
  currentMemberId,
  confirmedAttendees = [],
  tripNotes,
  reservationInstructions,
  drivingDirections,
  api,
  section = "all",
  onEditLogistics,
  onOpenPackingChecklist,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [commitments, setCommitments] = useState<TripCommitment[]>([]);
  const [carpools, setCarpools] = useState<TripCarpool[]>([]);
  const [memberReadiness, setMemberReadiness] = useState<MemberReadiness | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<CommitmentCategory | "all">("all");
  const [actionBusy, setActionBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Modal states
  const [showAddCommitmentModal, setShowAddCommitmentModal] = useState(false);
  const [showAddCarpoolModal, setShowAddCarpoolModal] = useState(false);
  const [editingCarpool, setEditingCarpool] = useState<TripCarpool | null>(null);
  const [mileageCarpool, setMileageCarpool] = useState<TripCarpool | null>(null);

  // Add commitment form state
  const [newItemName, setNewItemName] = useState("");
  const [newItemCategory, setNewItemCategory] = useState<CommitmentCategory>("gear");
  const [newItemQuantity, setNewItemQuantity] = useState("");
  const [newItemIsCritical, setNewItemIsCritical] = useState(false);
  const [newItemAssignee, setNewItemAssignee] = useState<string>("");

  // Carpool form state
  const [carpoolDriverId, setCarpoolDriverId] = useState("");
  const [carpoolVehicle, setCarpoolVehicle] = useState("");
  const [carpoolMaxSeats, setCarpoolMaxSeats] = useState(4);
  const [carpoolDeparture, setCarpoolDeparture] = useState("");
  const [carpoolSelectedRiders, setCarpoolSelectedRiders] = useState<string[]>([]);

  // Mileage form state
  const [mileageStart, setMileageStart] = useState<string>("");
  const [mileageEnd, setMileageEnd] = useState<string>("");

  async function loadLogistics() {
    setErrorMsg(null);
    try {
      const data = await api<{
        commitments: TripCommitment[];
        carpools: TripCarpool[];
        memberReadiness: MemberReadiness;
      }>("get_trip_logistics", { tripId });

      setCommitments(data.commitments ?? []);
      setCarpools(data.carpools ?? []);
      setMemberReadiness(data.memberReadiness ?? null);
    } catch {
      setErrorMsg("Failed to load logistics information.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadLogistics();
  }, [tripId]);

  // Commitment claim/unclaim
  async function handleClaim(commitmentId: string) {
    setActionBusy(true);
    setErrorMsg(null);
    try {
      await api("manage_trip_commitment", {
        tripId,
        action: "claim",
        commitmentId,
      });
      await loadLogistics();
    } catch {
      setErrorMsg("Unable to claim item. It may have already been claimed.");
    } finally {
      setActionBusy(false);
    }
  }

  async function handleUnclaim(commitmentId: string) {
    setActionBusy(true);
    setErrorMsg(null);
    try {
      await api("manage_trip_commitment", {
        tripId,
        action: "unclaim",
        commitmentId,
      });
      await loadLogistics();
    } catch {
      setErrorMsg("Unable to unclaim item.");
    } finally {
      setActionBusy(false);
    }
  }

  async function handleDeleteCommitment(commitmentId: string) {
    if (!window.confirm("Are you sure you want to remove this commitment item?")) return;
    setActionBusy(true);
    setErrorMsg(null);
    try {
      await api("manage_trip_commitment", {
        tripId,
        action: "admin_delete",
        commitmentId,
      });
      await loadLogistics();
    } catch {
      setErrorMsg("Failed to delete commitment.");
    } finally {
      setActionBusy(false);
    }
  }

  async function handleSyncFromCatalog() {
    setActionBusy(true);
    setErrorMsg(null);
    try {
      await api("admin_sync_trip_commitments", { tripId });
      await loadLogistics();
    } catch {
      setErrorMsg("Failed to sync commitments from Master Catalog.");
    } finally {
      setActionBusy(false);
    }
  }

  async function handleSaveNewCommitment(e: React.FormEvent) {
    e.preventDefault();
    if (!newItemName.trim()) return;
    setActionBusy(true);
    setErrorMsg(null);
    try {
      await api("manage_trip_commitment", {
        tripId,
        action: "admin_create",
        itemName: newItemName.trim(),
        category: newItemCategory,
        quantityDescription: newItemQuantity.trim() || null,
        isCritical: newItemIsCritical,
        assignedMemberId: newItemAssignee || null,
        commitmentType: "shared_volunteer",
      });
      setShowAddCommitmentModal(false);
      setNewItemName("");
      setNewItemQuantity("");
      setNewItemIsCritical(false);
      setNewItemAssignee("");
      await loadLogistics();
    } catch {
      setErrorMsg("Failed to add commitment item.");
    } finally {
      setActionBusy(false);
    }
  }

  // Carpool creation and editing
  function openAddCarpoolModal() {
    setCarpoolDriverId(confirmedAttendees[0]?.memberId || currentMemberId || "");
    setCarpoolVehicle("");
    setCarpoolMaxSeats(4);
    setCarpoolDeparture("");
    setCarpoolSelectedRiders([]);
    setEditingCarpool(null);
    setShowAddCarpoolModal(true);
  }

  function openEditCarpoolModal(cp: TripCarpool) {
    setEditingCarpool(cp);
    setCarpoolDriverId(cp.driverMemberId);
    setCarpoolVehicle(cp.vehicleDescription);
    setCarpoolMaxSeats(cp.maxSeats);
    setCarpoolDeparture(cp.departureDetails || "");
    setCarpoolSelectedRiders(cp.riders.map((r) => r.riderMemberId));
    setShowAddCarpoolModal(true);
  }

  async function handleSaveCarpool(e: React.FormEvent) {
    e.preventDefault();
    if (!carpoolDriverId || !carpoolVehicle.trim()) return;
    setActionBusy(true);
    setErrorMsg(null);
    try {
      if (editingCarpool) {
        await api("admin_manage_carpool", {
          tripId,
          action: "admin_update_carpool",
          carpoolId: editingCarpool.id,
          driverMemberId: carpoolDriverId,
          vehicleDescription: carpoolVehicle.trim(),
          maxSeats: carpoolMaxSeats,
          departureDetails: carpoolDeparture.trim() || null,
          riderMemberIds: carpoolSelectedRiders,
        });
      } else {
        await api("admin_manage_carpool", {
          tripId,
          action: "admin_create_carpool",
          driverMemberId: carpoolDriverId,
          vehicleDescription: carpoolVehicle.trim(),
          maxSeats: carpoolMaxSeats,
          departureDetails: carpoolDeparture.trim() || null,
          riderMemberIds: carpoolSelectedRiders,
        });
      }
      setShowAddCarpoolModal(false);
      await loadLogistics();
    } catch {
      setErrorMsg("Failed to save carpool configuration.");
    } finally {
      setActionBusy(false);
    }
  }

  async function handleDeleteCarpool(carpoolId: string) {
    if (!window.confirm("Are you sure you want to remove this carpool?")) return;
    setActionBusy(true);
    setErrorMsg(null);
    try {
      await api("admin_manage_carpool", {
        tripId,
        action: "admin_delete_carpool",
        carpoolId,
      });
      await loadLogistics();
    } catch {
      setErrorMsg("Failed to delete carpool.");
    } finally {
      setActionBusy(false);
    }
  }

  function openMileageModal(cp: TripCarpool) {
    setMileageCarpool(cp);
    setMileageStart(cp.startingMileage != null ? String(cp.startingMileage) : "");
    setMileageEnd(cp.endingMileage != null ? String(cp.endingMileage) : "");
  }

  async function handleSaveMileage(e: React.FormEvent) {
    e.preventDefault();
    if (!mileageCarpool) return;
    setActionBusy(true);
    setErrorMsg(null);
    try {
      const s = mileageStart.trim() ? Number(mileageStart) : null;
      const endVal = mileageEnd.trim() ? Number(mileageEnd) : null;
      if (s != null && endVal != null && endVal < s) {
        setErrorMsg("Ending mileage cannot be less than starting mileage.");
        setActionBusy(false);
        return;
      }
      await api("record_carpool_mileage", {
        tripId,
        carpoolId: mileageCarpool.id,
        startingMileage: s,
        endingMileage: endVal,
      });
      setMileageCarpool(null);
      await loadLogistics();
    } catch {
      setErrorMsg("Failed to record mileage.");
    } finally {
      setActionBusy(false);
    }
  }

  if (loading) {
    return <p style={{ padding: "1rem" }}>Loading trip logistics and commitments…</p>;
  }

  // Individual packing items belong exclusively in Personal Packing Checklist.
  // Trip Commitments are strictly for shared volunteer items.
  const sharedCommitments = commitments.filter(
    (c) => c.commitmentType !== "individual_pack" && c.isActive !== false
  );
  const individualItemsCount = commitments.filter(
    (c) => c.commitmentType === "individual_pack" && c.isActive !== false
  ).length;
  const criticalMissing = sharedCommitments.filter((c) => c.isCritical && !c.assignedMemberId);
  const filteredCommitments =
    selectedCategory === "all" ? sharedCommitments : sharedCommitments.filter((c) => c.category === selectedCategory);

  return (
    <div className="stack" style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {errorMsg && (
        <div role="alert" className="form-error" style={{ padding: "0.75rem", borderRadius: "6px" }}>
          {errorMsg}
        </div>
      )}

      {/* Critical Missing Banner */}
      {criticalMissing.length > 0 && (
        <div
          role="alert"
          style={{
            background: "#fef2f2",
            border: "1px solid #f87171",
            color: "#991b1b",
            padding: "0.85rem 1.25rem",
            borderRadius: "8px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "0.5rem",
          }}
        >
          <div>
            <strong>⚠️ {criticalMissing.length} Critical Items Missing:</strong> These items are required for the trip.
            Please volunteer to bring one below!
          </div>
        </div>
      )}

      {/* Member Carpool Summary Banner */}
      {isConfirmedAttendee && memberReadiness && (
        <div
          style={{
            background: "#f0fdf4",
            border: "1px solid #86efac",
            color: "#166534",
            padding: "0.85rem 1.25rem",
            borderRadius: "8px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "0.5rem",
          }}
        >
          {(section === "all" || section === "transportation") && (
            <div>
              <strong>🚗 Your Transportation: </strong>
              {memberReadiness.carpoolRole === "driver" && `You are driving a carpool.`}
              {memberReadiness.carpoolRole === "rider" && `${memberReadiness.carpoolDetails}`}
              {memberReadiness.carpoolRole === "unassigned" && `You are not assigned to a carpool yet.`}
            </div>
          )}
          {(section === "all" || section === "gear") && (
            <div>
              <strong>🎒 Your Commitments: </strong>
              {memberReadiness.myCommitmentsCount > 0
                ? `Bringing ${memberReadiness.myCommitmentsCount} item(s)`
                : `None claimed yet`}
            </div>
          )}
        </div>
      )}

      {/* Carpools Card */}
      {(section === "all" || section === "transportation") && (
      <div className="card">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "1rem",
            flexWrap: "wrap",
            gap: "0.5rem",
          }}
        >
          <div>
            <h2 style={{ margin: 0 }}>🚗 Logistics, Carpools &amp; Transportation</h2>
            <p style={{ margin: "0.25rem 0 0", fontSize: "0.88rem", color: "#6b7280" }}>
              {carpools.length} vehicle(s) configured · Drivers record odometer mileage for post-trip reimbursement ($0.50/mi for 3+ passengers).
            </p>
            <p style={{ margin: "0.25rem 0 0", fontSize: "0.82rem", color: "#64748b", fontStyle: "italic" }}>
              ⚠️ Disclaimer: For carpools with fewer than 3 passengers, riders can collaborate to share the vehicle expenses directly between themselves.
            </p>
          </div>
          {isAdmin && (
            <button
              type="button"
              className="primary-button"
              style={{ fontSize: "0.85rem", padding: "0.4rem 0.8rem" }}
              onClick={openAddCarpoolModal}
            >
              + Add Carpool
            </button>
          )}
        </div>

        {carpools.length === 0 ? (
          <p style={{ color: "#6b7280", fontStyle: "italic" }}>
            No carpools have been scheduled for this trip yet.
          </p>
        ) : (
          <div style={{ display: "grid", gap: "1rem" }}>
            {carpools.map((cp) => {
              const canRecordMileage = isAdmin || cp.driverMemberId === currentMemberId;
              return (
                <div
                  key={cp.id}
                  style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: "8px",
                    padding: "1rem",
                    background: cp.isMyCarpool ? "#f8fafc" : "#ffffff",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      flexWrap: "wrap",
                      gap: "0.5rem",
                    }}
                  >
                    <div>
                      <h3 style={{ margin: 0, fontSize: "1.05rem" }}>
                        🚘 {cp.vehicleDescription}{" "}
                        <span style={{ fontSize: "0.85rem", color: "#6b7280", fontWeight: 400 }}>
                          (Driver: <strong>{cp.driverName}</strong>)
                        </span>
                      </h3>
                      <p style={{ margin: "0.25rem 0 0.5rem", fontSize: "0.85rem", color: "#4b5563" }}>
                        Seats: {cp.occupiedSeats} / {cp.maxSeats} occupied ({cp.availableSeats} available)
                      </p>
                    </div>

                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      {canRecordMileage && (
                        <button
                          type="button"
                          className="secondary-button"
                          style={{ fontSize: "0.8rem", padding: "0.3rem 0.6rem" }}
                          onClick={() => openMileageModal(cp)}
                        >
                          📍 Odometer / Mileage
                        </button>
                      )}
                      {isAdmin && (
                        <>
                          <button
                            type="button"
                            className="secondary-button"
                            style={{ fontSize: "0.8rem", padding: "0.3rem 0.6rem" }}
                            onClick={() => openEditCarpoolModal(cp)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="secondary-button"
                            style={{ fontSize: "0.8rem", padding: "0.3rem 0.6rem", color: "#dc2626" }}
                            onClick={() => void handleDeleteCarpool(cp.id)}
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {cp.departureDetails && (
                    <p style={{ margin: "0.5rem 0", fontSize: "0.85rem", color: "#374151" }}>
                      <strong>Departure details:</strong> {cp.departureDetails}
                    </p>
                  )}

                  {/* Mileage Status */}
                  <div
                    style={{
                      background: "#f1f5f9",
                      padding: "0.5rem 0.75rem",
                      borderRadius: "6px",
                      margin: "0.5rem 0",
                      fontSize: "0.82rem",
                      display: "flex",
                      gap: "1.25rem",
                      flexWrap: "wrap",
                    }}
                  >
                    <span>
                      Start Odometer:{" "}
                      <strong>{cp.startingMileage != null ? `${cp.startingMileage} mi` : "Not recorded"}</strong>
                    </span>
                    <span>
                      End Odometer:{" "}
                      <strong>{cp.endingMileage != null ? `${cp.endingMileage} mi` : "Not recorded"}</strong>
                    </span>
                    <span>
                      Total Trip Miles:{" "}
                      <strong>{cp.totalMiles != null ? `${cp.totalMiles} mi` : "Pending completion"}</strong>
                    </span>
                  </div>

                  {/* Riders */}
                  <div style={{ marginTop: "0.5rem" }}>
                    <span style={{ fontSize: "0.82rem", color: "#6b7280", marginRight: "0.5rem" }}>Passengers:</span>
                    {cp.riders.length === 0 ? (
                      <span style={{ fontSize: "0.82rem", color: "#9ca3af" }}>No passengers assigned yet</span>
                    ) : (
                      cp.riders.map((r) => (
                        <span
                          key={r.id}
                          className="badge-pill"
                          style={{
                            background: r.isMe ? "#dcfce7" : "#e2e8f0",
                            color: r.isMe ? "#166534" : "#1e293b",
                            marginRight: "0.4rem",
                            fontSize: "0.78rem",
                          }}
                        >
                          {r.displayName} {r.isMe && "(You)"}
                        </span>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      )}

      {/* Commitments Card */}
      {(section === "all" || section === "gear") && (
      <div className="card">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "1rem",
            flexWrap: "wrap",
            gap: "0.5rem",
          }}
        >
          <div>
            <h2 style={{ margin: 0 }}>🎒 Trip Commitments (Gear &amp; Supplies)</h2>
            <p style={{ margin: "0.25rem 0 0", fontSize: "0.88rem", color: "#6b7280" }}>
              Volunteer to bring shared gear, food, shelter, and safety supplies. (Personal packing items are in your Personal Packing Checklist).
            </p>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {onOpenPackingChecklist && (
              <button
                type="button"
                className="secondary-button"
                style={{ fontSize: "0.85rem", padding: "0.4rem 0.8rem" }}
                onClick={onOpenPackingChecklist}
                title="View your personal packing checklist"
              >
                🎒 Personal Packing Checklist {individualItemsCount > 0 ? `(${individualItemsCount})` : ""}
              </button>
            )}
            {isAdmin && (
              <>
                <button
                  type="button"
                  className="secondary-button"
                  style={{ fontSize: "0.85rem", padding: "0.4rem 0.8rem" }}
                  disabled={actionBusy}
                  onClick={() => void handleSyncFromCatalog()}
                  title="Sync shared and individual gear/groceries from Master Catalog"
                >
                  🔄 Sync from Catalog
                </button>
                <button
                  type="button"
                  className="primary-button"
                  style={{ fontSize: "0.85rem", padding: "0.4rem 0.8rem" }}
                  onClick={() => setShowAddCommitmentModal(true)}
                >
                  + Add Item
                </button>
              </>
            )}
          </div>
        </div>

        {/* Category Filter Pills */}
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
          <button
            type="button"
            className={`rsvp-pill-btn ${selectedCategory === "all" ? "active selected" : ""}`}
            style={{ padding: "0.3rem 0.75rem", fontSize: "0.82rem" }}
            onClick={() => setSelectedCategory("all")}
          >
            All Items ({sharedCommitments.length})
          </button>
          {(Object.keys(CATEGORY_META) as CommitmentCategory[]).map((cat) => {
            const count = sharedCommitments.filter((c) => c.category === cat).length;
            return (
              <button
                key={cat}
                type="button"
                className={`rsvp-pill-btn ${selectedCategory === cat ? "active selected" : ""}`}
                style={{ padding: "0.3rem 0.75rem", fontSize: "0.82rem" }}
                onClick={() => setSelectedCategory(cat)}
              >
                {CATEGORY_META[cat].icon} {CATEGORY_META[cat].label} ({count})
              </button>
            );
          })}
        </div>

        {filteredCommitments.length === 0 ? (
          <p style={{ color: "#6b7280", fontStyle: "italic" }}>
            No items listed in this category yet.
          </p>
        ) : (
          <div style={{ display: "grid", gap: "0.6rem" }}>
            {filteredCommitments.map((c) => (
              <div
                key={c.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "0.75rem 1rem",
                  border: "1px solid #e5e7eb",
                  borderRadius: "8px",
                  background: c.isMine ? "#f0fdf4" : "#ffffff",
                  flexWrap: "wrap",
                  gap: "0.5rem",
                }}
              >
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                    <span style={{ fontSize: "1.1rem" }}>{CATEGORY_META[c.category]?.icon ?? "📦"}</span>
                    <strong>{c.itemName}</strong>
                    {c.quantityDescription && (
                      <span style={{ fontSize: "0.82rem", color: "#6b7280" }}>({c.quantityDescription})</span>
                    )}
                    {c.isCritical && (
                      <span
                        className="badge-pill"
                        style={{ background: "#fee2e2", color: "#991b1b", fontSize: "0.72rem", fontWeight: 700 }}
                      >
                        🚨 Critical Item
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: "0.82rem", color: "#4b5563", marginTop: "0.25rem" }}>
                    {c.assignedMemberName ? (
                      <span>
                        Assigned to: <strong>{c.assignedMemberName}</strong> {c.isMine && "(You)"}
                      </span>
                    ) : (
                      <span style={{ color: c.isCritical ? "#dc2626" : "#6b7280", fontWeight: c.isCritical ? 600 : 400 }}>
                        ⚠️ Unclaimed
                      </span>
                    )}
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  {isConfirmedAttendee && !c.assignedMemberId && (
                    <button
                      type="button"
                      className="primary-button"
                      style={{ fontSize: "0.8rem", padding: "0.3rem 0.75rem" }}
                      disabled={actionBusy}
                      onClick={() => void handleClaim(c.id)}
                    >
                      ✓ I'll Bring This
                    </button>
                  )}
                  {isConfirmedAttendee && c.isMine && (
                    <button
                      type="button"
                      className="secondary-button"
                      style={{ fontSize: "0.8rem", padding: "0.3rem 0.6rem" }}
                      disabled={actionBusy}
                      onClick={() => void handleUnclaim(c.id)}
                    >
                      Unclaim
                    </button>
                  )}
                  {isAdmin && (
                    <button
                      type="button"
                      className="secondary-button"
                      style={{ fontSize: "0.8rem", padding: "0.3rem 0.5rem", color: "#dc2626" }}
                      disabled={actionBusy}
                      onClick={() => void handleDeleteCommitment(c.id)}
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      )}

      {/* Trip Notes & Directions Card */}
      {(section === "all" || section === "gear") && (
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <h2 style={{ margin: 0 }}>📍 Notes, Directions &amp; Check-In</h2>
          {isAdmin && onEditLogistics && (
            <button
              type="button"
              className="secondary-button"
              style={{ fontSize: "0.85rem", padding: "0.3rem 0.75rem" }}
              onClick={onEditLogistics}
            >
              ✏️ Edit Notes &amp; Info
            </button>
          )}
        </div>

        <div style={{ marginBottom: "1.25rem" }}>
          <h3>Trip Notes &amp; Packing Recommendations</h3>
          {tripNotes ? (
            <p style={{ whiteSpace: "pre-wrap" }}>{tripNotes}</p>
          ) : (
            <p style={{ color: "#6b7280" }}>No notes added yet.</p>
          )}
        </div>

        {reservationInstructions && (
          <div style={{ marginBottom: "1.25rem" }}>
            <h3>Reservation &amp; Check-In Instructions</h3>
            <p style={{ whiteSpace: "pre-wrap" }}>{reservationInstructions}</p>
          </div>
        )}

        {drivingDirections && (
          <div style={{ marginBottom: "1.25rem" }}>
            <h3>Driving &amp; Travel Directions</h3>
            <p style={{ whiteSpace: "pre-wrap" }}>{drivingDirections}</p>
          </div>
        )}
      </div>
      )}

      {/* Modal: Add Commitment */}
      {showAddCommitmentModal && (
        <div className="modal-backdrop">
          <div className="modal-content" style={{ maxWidth: "480px" }}>
            <h3>Add Commitment Item</h3>
            <form onSubmit={(e) => void handleSaveNewCommitment(e)}>
              <label>
                Item Name:
                <input
                  type="text"
                  required
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  placeholder="e.g., Propane Camp Stove"
                />
              </label>

              <label>
                Category:
                <select
                  value={newItemCategory}
                  onChange={(e) => setNewItemCategory(e.target.value as CommitmentCategory)}
                >
                  <option value="gear">🍳 Cooking &amp; Camp Gear</option>
                  <option value="food">🍎 Food &amp; Ingredients</option>
                  <option value="supplies">🪵 Wood &amp; Camp Supplies</option>
                  <option value="shelter">⛺ Tents &amp; Canopies</option>
                  <option value="safety">🩹 First Aid &amp; Safety</option>
                </select>
              </label>

              <label>
                Quantity / Description:
                <input
                  type="text"
                  value={newItemQuantity}
                  onChange={(e) => setNewItemQuantity(e.target.value)}
                  placeholder="e.g., 2 burners + 2 propane canisters"
                />
              </label>

              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", margin: "0.75rem 0" }}>
                <input
                  type="checkbox"
                  checked={newItemIsCritical}
                  onChange={(e) => setNewItemIsCritical(e.target.checked)}
                />
                <span>
                  <strong>Critical Item</strong> (Essential for camp operation)
                </span>
              </label>

              <label>
                Pre-assign Member (Optional):
                <select value={newItemAssignee} onChange={(e) => setNewItemAssignee(e.target.value)}>
                  <option value="">Leave unassigned (Open for volunteers)</option>
                  {confirmedAttendees.map((m) => (
                    <option key={m.memberId} value={m.memberId}>
                      {m.displayName}
                    </option>
                  ))}
                </select>
              </label>

              <div className="modal-actions" style={{ marginTop: "1.25rem" }}>
                <button type="button" className="secondary-button" onClick={() => setShowAddCommitmentModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="primary-button" disabled={actionBusy}>
                  {actionBusy ? "Saving…" : "Add Item"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Add/Edit Carpool */}
      {showAddCarpoolModal && (
        <div className="modal-backdrop">
          <div className="modal-content" style={{ maxWidth: "520px" }}>
            <h3>{editingCarpool ? "Edit Carpool" : "Add Carpool"}</h3>
            <form onSubmit={(e) => void handleSaveCarpool(e)}>
              <label>
                Driver:
                <select
                  required
                  value={carpoolDriverId}
                  onChange={(e) => setCarpoolDriverId(e.target.value)}
                >
                  <option value="">Select a driver</option>
                  {confirmedAttendees.map((m) => (
                    <option key={m.memberId} value={m.memberId}>
                      {m.displayName}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Vehicle Description:
                <input
                  type="text"
                  required
                  value={carpoolVehicle}
                  onChange={(e) => setCarpoolVehicle(e.target.value)}
                  placeholder="e.g., Blue Subaru Outback"
                />
              </label>

              <label>
                Maximum Seats (including driver):
                <input
                  type="number"
                  min={1}
                  max={15}
                  required
                  value={carpoolMaxSeats}
                  onChange={(e) => setCarpoolMaxSeats(Number(e.target.value))}
                />
              </label>

              <label>
                Departure Details:
                <input
                  type="text"
                  value={carpoolDeparture}
                  onChange={(e) => setCarpoolDeparture(e.target.value)}
                  placeholder="e.g., Leaving Friday 4:00 PM from North Gate Park & Ride"
                />
              </label>

              <div style={{ marginTop: "0.75rem" }}>
                <label>Assigned Passengers:</label>
                <div style={{ maxHeight: "140px", overflowY: "auto", border: "1px solid #e5e7eb", padding: "0.5rem", borderRadius: "6px" }}>
                  {confirmedAttendees
                    .filter((m) => m.memberId !== carpoolDriverId)
                    .map((m) => {
                      const isSelected = carpoolSelectedRiders.includes(m.memberId);
                      return (
                        <label key={m.memberId} style={{ display: "flex", alignItems: "center", gap: "0.4rem", margin: "0.25rem 0" }}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setCarpoolSelectedRiders([...carpoolSelectedRiders, m.memberId]);
                              } else {
                                setCarpoolSelectedRiders(carpoolSelectedRiders.filter((id) => id !== m.memberId));
                              }
                            }}
                          />
                          <span>{m.displayName}</span>
                        </label>
                      );
                    })}
                </div>
              </div>

              <div className="modal-actions" style={{ marginTop: "1.25rem" }}>
                <button type="button" className="secondary-button" onClick={() => setShowAddCarpoolModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="primary-button" disabled={actionBusy}>
                  {actionBusy ? "Saving…" : "Save Carpool"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Mileage */}
      {mileageCarpool && (
        <div className="modal-backdrop">
          <div className="modal-content" style={{ maxWidth: "420px" }}>
            <h3>Record Carpool Mileage</h3>
            <p style={{ fontSize: "0.88rem", color: "#4b5563" }}>
              Driver: <strong>{mileageCarpool.driverName}</strong> ({mileageCarpool.vehicleDescription})
            </p>
            <form onSubmit={(e) => void handleSaveMileage(e)}>
              <label>
                Starting Odometer (miles):
                <input
                  type="number"
                  step="0.1"
                  value={mileageStart}
                  onChange={(e) => setMileageStart(e.target.value)}
                  placeholder="e.g., 45210.0"
                />
              </label>

              <label>
                Ending Odometer (miles):
                <input
                  type="number"
                  step="0.1"
                  value={mileageEnd}
                  onChange={(e) => setMileageEnd(e.target.value)}
                  placeholder="e.g., 45430.5"
                />
              </label>

              {mileageStart && mileageEnd && Number(mileageEnd) >= Number(mileageStart) && (
                <p style={{ background: "#f0fdf4", color: "#166534", padding: "0.5rem", borderRadius: "4px", fontSize: "0.85rem" }}>
                  Total Trip Distance: <strong>{(Number(mileageEnd) - Number(mileageStart)).toFixed(1)} miles</strong>
                </p>
              )}

              <div className="modal-actions" style={{ marginTop: "1.25rem" }}>
                <button type="button" className="secondary-button" onClick={() => setMileageCarpool(null)}>
                  Cancel
                </button>
                <button type="submit" className="primary-button" disabled={actionBusy}>
                  {actionBusy ? "Saving…" : "Save Mileage"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
