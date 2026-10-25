import React, { useEffect, useMemo, useState } from "react";
import type { TripApiType } from "./EventDetailsPage";
import { invokeTripApi } from "../../lib/supabase";

const defaultApi: TripApiType = (action, input) => invokeTripApi(action, input);

export type TripActivityGroupMember = {
  id: string;
  group_id: string;
  member_id: string;
  display_name?: string | null;
};

export type TripActivityGroup = {
  id: string;
  activity_id: string;
  group_number: number;
  group_name?: string | null;
  group_label?: string | null;
  capacity?: number;
  purchaser_member_id?: string | null;
  purchaser_display_name?: string | null;
  purchase_date?: string | null;
  amount_cents?: number | null;
  voucher_amount_cents?: number | null;
  expense_id?: string | null;
  order_number?: string | null;
  order_reference_number?: string | null;
  voucher_code?: string | null;
  security_pin?: string | null;
  voucher_status: "needed" | "pending" | "purchased" | "verified" | "exempt" | string;
  members?: TripActivityGroupMember[];
};

export type TripActivitySwapRequest = {
  id: string;
  activity_id: string;
  requester_member_id: string;
  requester_display_name?: string | null;
  target_member_id: string;
  target_display_name?: string | null;
  status: "pending" | "accepted" | "declined" | "cancelled" | string;
  created_at?: string;
};

export type TripActivityItem = {
  id: string;
  trip_id: string;
  master_activity_id?: string | null;
  title: string;
  category?: string;
  image_url?: string | null;
  location_name?: string | null;
  address?: string | null;
  directions_url?: string | null;
  deal_strategy_tip?: string | null;
  voucher_url?: string | null;
  booking_url?: string | null;
  waiver_url?: string | null;
  activity_date: string;
  start_time?: string | null;
  end_time?: string | null;
  unit_label?: string | null;
  unit_capacity?: number | null;
  booking_notes?: string | null;
  opt_out_policy?: "locked_on_voucher" | "flexible" | null;
  is_pairings_locked?: boolean | null;
  participants?: Array<{
    id: string;
    activity_id: string;
    member_id: string;
    status: "attending" | "opted_out";
    paired_with_member_id?: string | null;
    display_name?: string | null;
    notes?: string | null;
    waiver_clicked_at?: string | null;
    waiver_signed_at?: string | null;
  }>;
  groups?: TripActivityGroup[];
  swap_requests?: TripActivitySwapRequest[];
  trip_attendees?: Array<{ member_id: string; display_name: string }>;
};

export type TripActivitiesTabProps = {
  tripId: string;
  isAdmin: boolean;
  isAccountant?: boolean;
  isConfirmedAttendee: boolean;
  currentMemberId?: string;
  tripAttendees?: Array<{ memberId: string; displayName: string }>;
  api?: TripApiType;
  onRefresh?: () => Promise<void> | void;
};

export const ACTIVITY_CATEGORIES: Record<string, { label: string; icon: string }> = {
  tour: { label: "Tour & Sightseeing", icon: "🗺️" },
  water: { label: "Water Sports", icon: "🛶" },
  outdoor: { label: "Outdoor & Adventure", icon: "🏔️" },
  entertainment: { label: "Entertainment & Games", icon: "🎪" },
  other: { label: "Other / Leisure", icon: "🎯" },
};

export function getBookingButtonLabel(act: TripActivityItem, bookingUrl?: string | null): string {
  const url = (bookingUrl || act.booking_url || act.voucher_url || act.booking_notes || "").toLowerCase();
  const tip = act.deal_strategy_tip || "";
  const priceMatch = tip.match(/\$[\d,]+(\.\d{2})?/);
  const priceSuffix = priceMatch ? ` (${priceMatch[0]})` : "";

  if (url.includes("groupon")) {
    return `🎟️ Buy Voucher on Groupon${priceSuffix} →`;
  }
  return `🎟️ Activity Booking Link →`;
}

export function formatActivitySchedule(
  dateStr?: string | null,
  startTime?: string | null,
  endTime?: string | null
): string {
  if (!dateStr) return "";
  const parts = dateStr.split("-").map(Number);
  let formattedDate = "";
  if (parts.length === 3) {
    formattedDate = new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])));
  } else {
    formattedDate = dateStr;
  }

  const formatT = (t?: string | null) => {
    if (!t) return "";
    const [hStr, mStr] = t.split(":");
    let h = parseInt(hStr, 10);
    const m = mStr || "00";
    if (isNaN(h)) return t;
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12;
    if (h === 0) h = 12;
    return `${h}:${m} ${ampm}`;
  };

  const formattedStart = formatT(startTime);
  const formattedEnd = formatT(endTime);

  if (formattedStart && formattedEnd) {
    return `${formattedDate} • ${formattedStart} – ${formattedEnd}`;
  }
  if (formattedStart) {
    return `${formattedDate} • ${formattedStart}`;
  }
  return formattedDate;
}

export function TripActivitiesTab({
  tripId,
  isAdmin,
  isAccountant = false,
  isConfirmedAttendee,
  currentMemberId,
  tripAttendees,
  api = defaultApi,
  onRefresh,
}: TripActivitiesTabProps) {
  const [activities, setActivities] = useState<TripActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  // Modals state
  const [voucherModalGroup, setVoucherModalGroup] = useState<{
    activity: TripActivityItem;
    group: TripActivityGroup;
  } | null>(null);
  const [callSheetActivity, setCallSheetActivity] = useState<TripActivityItem | null>(null);
  const [callSheetCopied, setCallSheetCopied] = useState(false);
  const [swapModalState, setSwapModalState] = useState<{
    activity: TripActivityItem;
    group: TripActivityGroup;
  } | null>(null);
  const [assignModalGroup, setAssignModalGroup] = useState<{
    activity: TripActivityItem;
    group: TripActivityGroup;
  } | null>(null);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [editingActivity, setEditingActivity] = useState<TripActivityItem | null>(null);
  const [clickedWaiverIds, setClickedWaiverIds] = useState<Set<string>>(new Set());
  const [waiverBusy, setWaiverBusy] = useState(false);

  async function handleWaiverClick(activityId: string) {
    setClickedWaiverIds((prev) => new Set(prev).add(activityId));
    try {
      await api("record_activity_waiver_click", { activityId });
      await loadActivities();
    } catch (err) {
      console.error("Failed to record waiver click:", err);
    }
  }

  async function handleConfirmWaiverSigned(activityId: string) {
    setWaiverBusy(true);
    setError(null);
    try {
      await api("confirm_activity_waiver_signed", { activityId });
      await loadActivities();
      if (onRefresh) await onRefresh();
    } catch (err: any) {
      console.error("Failed to confirm waiver signed:", err);
      setError(err?.message || "Failed to confirm waiver signature.");
    } finally {
      setWaiverBusy(false);
    }
  }

  const attendeesList = useMemo(() => {
    if (tripAttendees && tripAttendees.length > 0) return tripAttendees;
    const map = new Map<string, { memberId: string; displayName: string }>();
    for (const act of activities) {
      for (const p of act.participants || []) {
        map.set(p.member_id, { memberId: p.member_id, displayName: p.display_name || "Camper" });
      }
    }
    return Array.from(map.values());
  }, [tripAttendees, activities]);

  async function loadActivities() {
    setError(null);
    try {
      const res = await api<{ activities?: TripActivityItem[] }>("get_trip_activities", {
        tripId,
      });
      setActivities(res?.activities || []);
    } catch (err: any) {
      console.error("Failed to load trip activities:", err);
      setError("Failed to load trip activities.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadActivities();
  }, [tripId]);

  async function refreshAll() {
    await loadActivities();
    if (onRefresh) {
      await onRefresh();
    }
  }

  async function handleDeleteActivity(activityId: string, activityTitle: string) {
    if (
      !window.confirm(
        `Are you sure you want to delete "${activityTitle}"? All vehicle pairings for this activity will be removed.`
      )
    ) {
      return;
    }
    setActionBusy(true);
    setActionMsg(null);
    setError(null);
    try {
      await api("admin_manage_trip_activity", {
        action: "delete",
        tripId,
        activityId,
      });
      await refreshAll();
      setActionMsg(`Activity "${activityTitle}" deleted.`);
    } catch (err: any) {
      console.error("Delete activity failed:", err);
      setError(err?.message || "Failed to delete activity.");
    } finally {
      setActionBusy(false);
    }
  }

  // Voucher submission
  async function handleSubmitVoucher(
    _activity: TripActivityItem,
    group: TripActivityGroup,
    data: {
      purchaserMemberId?: string;
      purchaseDate: string;
      orderNumber: string;
      voucherCode: string;
      securityPin: string;
      amountDollars: string;
    }
  ) {
    setActionBusy(true);
    setActionMsg(null);
    try {
      const costCents = Math.round(parseFloat(data.amountDollars || "0") * 100);
      await api("submit_activity_voucher", {
        tripId,
        groupId: group.id,
        purchaserMemberId: data.purchaserMemberId || currentMemberId,
        purchaseDate: data.purchaseDate || new Date().toISOString().slice(0, 10),
        orderNumber: data.orderNumber.trim() || undefined,
        voucherCode: data.voucherCode.trim() || undefined,
        securityPin: data.securityPin.trim() || undefined,
        voucherCostCents: costCents > 0 ? costCents : undefined,
      });
      setVoucherModalGroup(null);
      await refreshAll();
    } catch (err: any) {
      console.error("submit_activity_voucher failed:", err);
      setActionMsg(err?.message || "Failed to submit voucher details.");
    } finally {
      setActionBusy(false);
    }
  }

  // Partner swap actions
  async function handleRespondSwap(swapRequestId: string, status: "accepted" | "declined") {
    setActionBusy(true);
    setActionMsg(null);
    try {
      await api("respond_partner_swap", {
        swapRequestId,
        status,
      });
      await refreshAll();
    } catch (err: any) {
      console.error("respond_partner_swap failed:", err);
      setActionMsg(err?.message || "Failed to respond to partner swap request.");
    } finally {
      setActionBusy(false);
    }
  }

  async function handleRequestSwap(activityId: string, targetMemberId: string) {
    setActionBusy(true);
    setActionMsg(null);
    try {
      await api("request_partner_swap", {
        tripId,
        activityId,
        targetMemberId,
      });
      setSwapModalState(null);
      await refreshAll();
    } catch (err: any) {
      console.error("request_partner_swap failed:", err);
      setActionMsg(err?.message || "Failed to submit partner swap request.");
    } finally {
      setActionBusy(false);
    }
  }

  // Admin controls
  async function handleAddVehicle(activityId: string) {
    setActionBusy(true);
    setActionMsg(null);
    try {
      await api("admin_manage_activity_pairings", {
        tripId,
        activityId,
        action: "create_group",
      });
      await refreshAll();
    } catch (err: any) {
      console.error("Add vehicle failed:", err);
      setActionMsg(err?.message || "Failed to add vehicle.");
    } finally {
      setActionBusy(false);
    }
  }

  async function handleDeleteGroup(activityId: string, groupId: string, groupTitle: string) {
    if (
      typeof window !== "undefined" &&
      window.confirm &&
      !window.confirm(`Are you sure you want to delete ${groupTitle}?`)
    ) {
      return;
    }
    setActionBusy(true);
    setActionMsg(null);
    try {
      await api("admin_manage_activity_pairings", {
        tripId,
        activityId,
        action: "delete_group",
        groupId,
      });
      await refreshAll();
    } catch (err: any) {
      console.error("Delete vehicle failed:", err);
      setActionMsg(err?.message || "Failed to delete vehicle.");
    } finally {
      setActionBusy(false);
    }
  }

  async function handleAssignMembers(activityId: string, groupId: string, memberIds: string[]) {
    setActionBusy(true);
    setActionMsg(null);
    try {
      await api("admin_manage_activity_pairings", {
        tripId,
        activityId,
        action: "assign_members",
        groupId,
        memberIds,
      });
      setAssignModalGroup(null);
      await refreshAll();
    } catch (err: any) {
      console.error("Assign campers failed:", err);
      setActionMsg(err?.message || "Failed to assign campers.");
    } finally {
      setActionBusy(false);
    }
  }

  async function handleAutoShuffle(activityId: string) {
    setActionBusy(true);
    setActionMsg(null);
    try {
      await api("admin_manage_activity_pairings", {
        activityId,
        action: "auto_shuffle",
      });
      await refreshAll();
    } catch (err: any) {
      console.error("Auto-shuffle failed:", err);
      setActionMsg(err?.message || "Failed to auto-shuffle pairings.");
    } finally {
      setActionBusy(false);
    }
  }

  async function handleToggleLock(activity: TripActivityItem) {
    setActionBusy(true);
    setActionMsg(null);
    const newLockState = !activity.is_pairings_locked;
    try {
      await api("admin_manage_activity_pairings", {
        activityId: activity.id,
        action: newLockState ? "lock_pairings" : "unlock_pairings",
      });
      await refreshAll();
    } catch (err: any) {
      console.error("Toggle lock failed:", err);
      setActionMsg(err?.message || "Failed to update pairing lock state.");
    } finally {
      setActionBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="card" style={{ padding: "2rem", textAlign: "center", color: "#64748b" }}>
        Loading trip activities…
      </div>
    );
  }

  return (
    <div className="stack" style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {/* Top Banner & Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "12px",
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: "1.4rem" }}>🎯 Trip Activities &amp; Vehicle Pairings</h2>
          <p style={{ margin: "4px 0 0 0", color: "#64748b", fontSize: "0.9rem" }}>
            Explore scheduled excursions, view your vehicle partner, enter discount vouchers, and request pairings.
          </p>
        </div>
        {isAdmin && (
          <button
            type="button"
            className="primary-button"
            style={{ fontSize: "0.85rem", padding: "8px 14px" }}
            onClick={() => setAddModalOpen(true)}
          >
            + Add Activity
          </button>
        )}
      </div>

      {actionMsg && (
        <div
          role="alert"
          style={{
            background: "#fef2f2",
            border: "1px solid #fecdd3",
            color: "#991b1b",
            padding: "10px 14px",
            borderRadius: "6px",
            fontSize: "0.9rem",
          }}
        >
          {actionMsg}
        </div>
      )}

      {error && (
        <div
          role="alert"
          style={{
            background: "#fef2f2",
            border: "1px solid #fecdd3",
            color: "#991b1b",
            padding: "12px 16px",
            borderRadius: "6px",
          }}
        >
          {error}
        </div>
      )}

      {activities.length === 0 ? (
        <div
          className="card"
          style={{
            padding: "3rem 1.5rem",
            textAlign: "center",
            color: "#64748b",
            border: "2px dashed #cbd5e1",
            borderRadius: "8px",
          }}
        >
          <div style={{ fontSize: "2.5rem", marginBottom: "0.5rem" }}>🎯</div>
          <h3 style={{ margin: "0 0 0.5rem 0", color: "#334155" }}>No Activities Scheduled Yet</h3>
          <p style={{ margin: 0, fontSize: "0.9rem" }}>
            Check back later for tours, water activities, and excursions planned for this camping trip.
          </p>
          {isAdmin && (
            <button
              type="button"
              className="primary-button"
              style={{ marginTop: "1rem", fontSize: "0.85rem" }}
              onClick={() => setAddModalOpen(true)}
            >
              + Add First Activity
            </button>
          )}
        </div>
      ) : (
        activities.map((act) => {
          const catInfo = ACTIVITY_CATEGORIES[act.category || "other"] || {
            label: act.category || "Activity",
            icon: "🎯",
          };
          const scheduleLabel = formatActivitySchedule(
            act.activity_date,
            act.start_time,
            act.end_time
          );
          const directionsUrl =
            act.directions_url ||
            (act.address || act.location_name
              ? `https://maps.google.com/?q=${encodeURIComponent(
                  [act.location_name, act.address].filter(Boolean).join(", ")
                )}`
              : null);

          // User participation and pairing
          const participant = (act.participants || []).find(
            (p) => p.member_id === currentMemberId
          );
          const isOptedOut = participant?.status === "opted_out";
          const isAttending = participant?.status === "attending" || isConfirmedAttendee;

          const assignedGroup = (act.groups || []).find((g) =>
            (g.members || []).some((m) => m.member_id === currentMemberId)
          );

          const partners = assignedGroup
            ? (assignedGroup.members || []).filter((m) => m.member_id !== currentMemberId)
            : [];
          const partnerNames = partners.map((p) => p.display_name || "Unknown").join(", ");
          const unitLabel = act.unit_label || "Vehicle";
          const groupDisplayLabel = assignedGroup
            ? assignedGroup.group_name || `${unitLabel} #${assignedGroup.group_number}`
            : "";

          // Pending swap request targeting current user
          const pendingSwap = (act.swap_requests || []).find(
            (s) => s.target_member_id === currentMemberId && s.status === "pending"
          );

          return (
            <div
              key={act.id}
              className="card"
              style={{
                borderRadius: "10px",
                overflow: "hidden",
                border: "1px solid #e2e8f0",
                padding: 0,
                background: "#ffffff",
                boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
              }}
            >
              {/* Hero Photo Banner */}
              <div
                style={{
                  height: "200px",
                  width: "100%",
                  background: "#1e293b",
                  position: "relative",
                  overflow: "hidden",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {act.image_url ? (
                  <img
                    src={act.image_url}
                    alt={act.title}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    onError={(e) => {
                      (e.currentTarget as HTMLElement).style.display = "none";
                      const fallback = e.currentTarget.parentElement?.querySelector(
                        ".hero-fallback"
                      ) as HTMLElement | null;
                      if (fallback) fallback.style.display = "flex";
                    }}
                  />
                ) : null}
                <div
                  className="hero-fallback"
                  style={{
                    display: act.image_url ? "none" : "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#94a3b8",
                    gap: "6px",
                  }}
                >
                  <span style={{ fontSize: "3rem" }}>{catInfo.icon}</span>
                  <span style={{ fontSize: "0.9rem", fontWeight: 500 }}>{catInfo.label}</span>
                </div>

                {/* Top overlay category & lock badge */}
                <div
                  style={{
                    position: "absolute",
                    top: "12px",
                    left: "12px",
                    display: "flex",
                    gap: "8px",
                  }}
                >
                  <span
                    style={{
                      background: "rgba(15, 23, 42, 0.8)",
                      color: "#f8fafc",
                      padding: "4px 10px",
                      borderRadius: "9999px",
                      fontSize: "0.78rem",
                      fontWeight: 600,
                      backdropFilter: "blur(4px)",
                    }}
                  >
                    {catInfo.icon} {catInfo.label}
                  </span>
                  {act.is_pairings_locked && (
                    <span
                      style={{
                        background: "rgba(180, 83, 9, 0.9)",
                        color: "#fff",
                        padding: "4px 10px",
                        borderRadius: "9999px",
                        fontSize: "0.78rem",
                        fontWeight: 600,
                      }}
                    >
                      🔒 Pairings Locked
                    </span>
                  )}
                </div>
              </div>

              {/* Activity Details Body */}
              <div style={{ padding: "1.25rem" }}>
                {/* Header Row */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    flexWrap: "wrap",
                    gap: "12px",
                  }}
                >
                  <div style={{ flex: "1 1 300px" }}>
                    <h3 style={{ margin: "0 0 6px 0", fontSize: "1.3rem", color: "#0f172a" }}>
                      {act.title}
                    </h3>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                        flexWrap: "wrap",
                        color: "#475569",
                        fontSize: "0.88rem",
                      }}
                    >
                      {scheduleLabel && (
                        <span>
                          📅 <strong>{scheduleLabel}</strong>
                        </span>
                      )}
                      {(act.location_name || act.address) && (
                        <span>
                          📍 {[act.location_name, act.address].filter(Boolean).join(" • ")}
                        </span>
                      )}
                      {directionsUrl && (
                        <a
                          href={directionsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            color: "#0284c7",
                            fontWeight: 600,
                            textDecoration: "underline",
                          }}
                        >
                          🧭 Get Directions
                        </a>
                      )}
                    </div>
                  </div>

                  {(() => {
                    const effectiveBookingUrl =
                      act.booking_url ||
                      (act.booking_notes && /^https?:\/\//i.test(act.booking_notes.trim())
                        ? act.booking_notes.trim()
                        : null);

                    return (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          flexWrap: "wrap",
                        }}
                      >
                        {effectiveBookingUrl && (
                          <a
                            href={effectiveBookingUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="primary-button"
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "6px",
                              background: "#d97706",
                              borderColor: "#b45309",
                              color: "#ffffff",
                              fontWeight: 700,
                              fontSize: "0.9rem",
                              padding: "8px 16px",
                              borderRadius: "6px",
                              textDecoration: "none",
                              boxShadow: "0 1px 2px rgba(0,0,0,0.08)",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {getBookingButtonLabel(act, effectiveBookingUrl)}
                          </a>
                        )}

                        {isAdmin && (
                          <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                            <button
                              type="button"
                              className="secondary-button"
                              style={{ fontSize: "0.85rem", padding: "8px 12px", whiteSpace: "nowrap" }}
                              onClick={() => setEditingActivity(act)}
                            >
                              ✏️ Edit Activity
                            </button>
                            <button
                              type="button"
                              className="danger-button"
                              style={{ fontSize: "0.85rem", padding: "8px 10px", color: "#dc2626" }}
                              title="Delete Activity"
                              aria-label={`Delete ${act.title}`}
                              onClick={() => handleDeleteActivity(act.id, act.title)}
                            >
                              🗑️
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* Deal Strategy Tip Banner */}
                {act.deal_strategy_tip && (
                  <div
                    style={{
                      background: "#fffbeb",
                      border: "1px solid #fef3c7",
                      borderLeft: "4px solid #f59e0b",
                      padding: "10px 14px",
                      borderRadius: "6px",
                      marginTop: "12px",
                      color: "#92400e",
                      fontSize: "0.88rem",
                      lineHeight: 1.45,
                    }}
                  >
                    <strong>💰 Deal Strategy Tip:</strong> {act.deal_strategy_tip}
                    {act.voucher_url && (
                      <div style={{ marginTop: "4px" }}>
                        <a
                          href={act.voucher_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: "#d97706", fontWeight: 600, textDecoration: "underline" }}
                        >
                          View Deal &amp; Purchase Codes &rarr;
                        </a>
                      </div>
                    )}
                  </div>
                )}

                {/* Booking Notes Banner */}
                {act.booking_notes &&
                  act.booking_notes.trim() !==
                    (act.booking_url ||
                      (act.booking_notes && /^https?:\/\//i.test(act.booking_notes.trim())
                        ? act.booking_notes.trim()
                        : null)) && (
                    <div
                      style={{
                        background: "#f8fafc",
                        border: "1px solid #e2e8f0",
                        borderLeft: "4px solid #0284c7",
                        padding: "10px 14px",
                        borderRadius: "6px",
                        marginTop: "12px",
                        color: "#334155",
                        fontSize: "0.88rem",
                        lineHeight: 1.45,
                      }}
                    >
                      <strong>📝 Booking Notes:</strong>{" "}
                      {/^https?:\/\//i.test(act.booking_notes.trim()) ? (
                        <a
                          href={act.booking_notes.trim()}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: "#0284c7", fontWeight: 600, textDecoration: "underline" }}
                        >
                          {act.booking_notes.trim()}
                        </a>
                      ) : (
                        act.booking_notes
                      )}
                    </div>
                  )}

                {/* Personalized Rider Badge */}
                {isOptedOut ? (
                  <div
                    style={{
                      background: "#f8fafc",
                      border: "1px solid #e2e8f0",
                      borderLeft: "4px solid #64748b",
                      padding: "10px 14px",
                      borderRadius: "6px",
                      marginTop: "12px",
                      color: "#334155",
                      fontWeight: 600,
                      fontSize: "0.9rem",
                    }}
                  >
                    🏕️ You have opted out of this tour (relaxing at camp).
                  </div>
                ) : isAttending ? (
                  assignedGroup ? (
                    <div
                      style={{
                        background: "#f0fdf4",
                        border: "1px solid #bbf7d0",
                        borderLeft: "4px solid #22c55e",
                        padding: "10px 14px",
                        borderRadius: "6px",
                        marginTop: "12px",
                        color: "#166534",
                        fontWeight: 600,
                        fontSize: "0.9rem",
                      }}
                    >
                      {partners.length > 0
                        ? `✓ You are Riding with ${partnerNames} (${groupDisplayLabel})`
                        : `✓ You are in ${groupDisplayLabel} (Solo / Spot open)`}
                    </div>
                  ) : (
                    <div
                      style={{
                        background: "#fef3c7",
                        border: "1px solid #fde68a",
                        borderLeft: "4px solid #f59e0b",
                        padding: "10px 14px",
                        borderRadius: "6px",
                        marginTop: "12px",
                        color: "#92400e",
                        fontWeight: 600,
                        fontSize: "0.9rem",
                      }}
                    >
                      ⚠️ You are attending, but not yet assigned to a vehicle.
                    </div>
                  )
                ) : null}

                {/* Operator Liability Waiver Banner */}
                {act.waiver_url && isAttending && !isOptedOut && (() => {
                  const isWaiverSigned = Boolean(participant?.waiver_signed_at);
                  const isWaiverClicked = Boolean(participant?.waiver_clicked_at || clickedWaiverIds.has(act.id));

                  return (
                    <div
                      data-testid="waiver-status-card"
                      style={{
                        background: isWaiverSigned ? "#f0fdf4" : "#fefce8",
                        border: `1.5px solid ${isWaiverSigned ? "#86efac" : "#fde047"}`,
                        borderLeft: `4px solid ${isWaiverSigned ? "#16a34a" : "#ca8a04"}`,
                        padding: "12px 14px",
                        borderRadius: "8px",
                        marginTop: "12px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        flexWrap: "wrap",
                        gap: "10px",
                      }}
                    >
                      <div style={{ flex: "1 1 280px" }}>
                        <div
                          style={{
                            fontWeight: 700,
                            color: isWaiverSigned ? "#166534" : "#854d0e",
                            fontSize: "0.92rem",
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                          }}
                        >
                          <span>{isWaiverSigned ? "✓" : "📝"}</span>
                          <span>
                            {isWaiverSigned
                              ? "Activity Liability Waiver Completed & Signed"
                              : "Activity Liability Waiver Required"}
                          </span>
                        </div>
                        <p style={{ margin: "4px 0 0 0", fontSize: "0.82rem", color: isWaiverSigned ? "#15803d" : "#713f12" }}>
                          {isWaiverSigned
                            ? "Thank you! Your signed waiver is confirmed on the tour operator call sheet."
                            : "The tour operator requires an electronic waiver signed on their website prior to the tour. Click the button to open and complete the waiver, then confirm completion."}
                        </p>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                        <a
                          href={act.waiver_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => {
                            void handleWaiverClick(act.id);
                          }}
                          className={isWaiverSigned ? "secondary-button" : "primary-button"}
                          style={{
                            fontSize: "0.84rem",
                            padding: "6px 14px",
                            textDecoration: "none",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                            ...(isWaiverSigned ? {} : { background: "#ca8a04", borderColor: "#a16207" }),
                          }}
                        >
                          {isWaiverSigned ? "View Waiver Form ↗" : "Open Waiver Form ↗"}
                        </a>

                        {!isWaiverSigned && (
                          <button
                            type="button"
                            className="primary-button"
                            disabled={!isWaiverClicked || waiverBusy}
                            title={!isWaiverClicked ? "Please click 'Open Waiver Form' first to fill out the form before confirming." : undefined}
                            onClick={() => void handleConfirmWaiverSigned(act.id)}
                            style={{
                              fontSize: "0.84rem",
                              padding: "6px 14px",
                              background: isWaiverClicked ? "#16a34a" : "#94a3b8",
                              borderColor: isWaiverClicked ? "#15803d" : "#64748b",
                              cursor: isWaiverClicked ? "pointer" : "not-allowed",
                            }}
                          >
                            {waiverBusy ? "Saving…" : "I Have Signed the Waiver ✓"}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* Pending Partner Swap Request Banner */}
                {pendingSwap && (
                  <div
                    style={{
                      background: "#eff6ff",
                      border: "1px solid #bfdbfe",
                      borderLeft: "4px solid #3b82f6",
                      padding: "12px 14px",
                      borderRadius: "6px",
                      marginTop: "12px",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      flexWrap: "wrap",
                      gap: "10px",
                    }}
                  >
                    <div style={{ color: "#1e40af", fontSize: "0.9rem" }}>
                      ⇄ Swap Request: {pendingSwap.requester_display_name || "Another member"} wants to swap pairings with you!
                    </div>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button
                        type="button"
                        className="primary-button"
                        style={{ padding: "5px 12px", fontSize: "0.82rem" }}
                        disabled={actionBusy}
                        onClick={() => handleRespondSwap(pendingSwap.id, "accepted")}
                      >
                        Accept Swap
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        style={{ padding: "5px 12px", fontSize: "0.82rem" }}
                        disabled={actionBusy}
                        onClick={() => handleRespondSwap(pendingSwap.id, "declined")}
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                )}

                {/* Call Sheet & Admin Action Bar */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: "8px",
                    marginTop: "16px",
                    paddingTop: "12px",
                    borderTop: "1px solid #f1f5f9",
                  }}
                >
                  <button
                    type="button"
                    className="secondary-button"
                    style={{ fontSize: "0.82rem", padding: "6px 12px" }}
                    onClick={() => {
                      setCallSheetActivity(act);
                      setCallSheetCopied(false);
                    }}
                  >
                    📞 Tour Operator Call Sheet
                  </button>

                  {isAdmin && (
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                      <button
                        type="button"
                        className="secondary-button"
                        style={{ fontSize: "0.82rem", padding: "6px 12px" }}
                        disabled={actionBusy}
                        onClick={() => handleAddVehicle(act.id)}
                      >
                        + Add Vehicle
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        style={{ fontSize: "0.82rem", padding: "6px 12px" }}
                        disabled={actionBusy}
                        onClick={() => handleAutoShuffle(act.id)}
                      >
                        🎲 Auto-Shuffle
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        style={{ fontSize: "0.82rem", padding: "6px 12px" }}
                        disabled={actionBusy}
                        onClick={() => handleToggleLock(act)}
                      >
                        {act.is_pairings_locked ? "🔓 Unlock Pairings" : "🔒 Lock Pairings"}
                      </button>
                    </div>
                  )}
                </div>

                {/* Vehicles Section */}
                {(() => {
                  const renderGroupCard = (grp: TripActivityGroup) => {
                    const isUserInGroup = (grp.members || []).some(
                      (m) => m.member_id === currentMemberId
                    );
                    const isPurchaser = Boolean(
                      currentMemberId && grp.purchaser_member_id === currentMemberId
                    );
                    const canEnterVoucher = isUserInGroup || isPurchaser || isAdmin || isAccountant;
                    const canDeleteGroup =
                      isAdmin &&
                      grp.voucher_status !== "purchased" &&
                      grp.voucher_status !== "verified";
                    const maxCap = grp.capacity || act.unit_capacity || 2;
                    const memberCount = grp.members?.length || 0;
                    const cardTitle = grp.group_name || `${unitLabel} #${grp.group_number}`;
                    const purchaserDisplayName =
                      grp.purchaser_display_name ||
                      attendeesList.find((a) => a.memberId === grp.purchaser_member_id)?.displayName ||
                      (isPurchaser ? "You" : null);

                    return (
                      <div
                        key={grp.id}
                        style={{
                          border: isUserInGroup
                            ? "2px solid #3b82f6"
                            : isPurchaser
                            ? "1.5px solid #f59e0b"
                            : "1px solid #e2e8f0",
                          borderRadius: "8px",
                          background: isUserInGroup ? "#f8fafc" : "#ffffff",
                          padding: "14px",
                          display: "flex",
                          flexDirection: "column",
                          gap: "10px",
                        }}
                      >
                        {/* Header & Voucher Badge */}
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "flex-start",
                            gap: "0.5rem",
                          }}
                        >
                          <div>
                            <h4 style={{ margin: 0, fontSize: "0.98rem", fontWeight: 700 }}>
                              {cardTitle}
                            </h4>
                            {grp.purchaser_member_id && (
                              <div
                                style={{
                                  fontSize: "0.8rem",
                                  color: "#b45309",
                                  fontWeight: 600,
                                  marginTop: "3px",
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "4px",
                                }}
                              >
                                <span>
                                  👑 Purchaser: {purchaserDisplayName || "Assigned"}
                                  {isPurchaser && purchaserDisplayName !== "You" ? " (You)" : ""}
                                </span>
                              </div>
                            )}
                          </div>
                          {grp.voucher_status === "purchased" || grp.voucher_status === "verified" ? (
                            <span
                              style={{
                                fontSize: "0.74rem",
                                fontWeight: 700,
                                padding: "2px 8px",
                                borderRadius: "9999px",
                                background: "#dcfce7",
                                color: "#166534",
                                whiteSpace: "nowrap",
                              }}
                            >
                              ✓ READY
                            </span>
                          ) : grp.voucher_status === "exempt" ? (
                            <span
                              style={{
                                fontSize: "0.74rem",
                                fontWeight: 700,
                                padding: "2px 8px",
                                borderRadius: "9999px",
                                background: "#f1f5f9",
                                color: "#475569",
                                whiteSpace: "nowrap",
                              }}
                            >
                              Exempt
                            </span>
                          ) : (
                            <span
                              style={{
                                fontSize: "0.74rem",
                                fontWeight: 700,
                                padding: "2px 8px",
                                borderRadius: "9999px",
                                background: "#fef3c7",
                                color: "#92400e",
                                whiteSpace: "nowrap",
                              }}
                            >
                              ⚠️ VOUCHER NEEDED
                            </span>
                          )}
                        </div>

                        {/* Capacity text */}
                        <div style={{ fontSize: "0.8rem", color: "#64748b" }}>
                          {memberCount} / {maxCap} Riders
                        </div>

                        {/* Assigned Riders */}
                        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                          {(grp.members || []).map((m) => {
                            const isMe = m.member_id === currentMemberId;
                            const isPartner = isUserInGroup && !isMe;
                            return (
                              <div
                                key={m.id || m.member_id}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  fontSize: "0.85rem",
                                  padding: "5px 8px",
                                  background: "#f1f5f9",
                                  borderRadius: "4px",
                                }}
                              >
                                <span style={{ fontWeight: isMe || isPartner ? 600 : 400 }}>
                                  {m.display_name || "Unknown"}
                                  {isMe ? " (You)" : isPartner ? " (Partner)" : ""}
                                </span>
                              </div>
                            );
                          })}
                          {memberCount < maxCap && (
                            <div
                              style={{
                                fontSize: "0.8rem",
                                fontStyle: "italic",
                                color: "#94a3b8",
                                padding: "5px 8px",
                                border: "1px dashed #cbd5e1",
                                borderRadius: "4px",
                                textAlign: "center",
                              }}
                            >
                              Open Spot
                            </div>
                          )}
                        </div>

                        {/* Voucher Info if present */}
                        {canEnterVoucher && (grp.order_number || grp.voucher_code) && (
                          <div
                            style={{
                              fontSize: "0.78rem",
                              background: "#f8fafc",
                              border: "1px solid #e2e8f0",
                              padding: "6px 8px",
                              borderRadius: "4px",
                              color: "#334155",
                              display: "grid",
                              gap: "2px",
                            }}
                          >
                            {grp.order_number && (
                              <div>
                                <strong>Order:</strong> {grp.order_number}
                              </div>
                            )}
                            {grp.voucher_code && (
                              <div>
                                <strong>Voucher:</strong> {grp.voucher_code}
                              </div>
                            )}
                            {grp.security_pin && (
                              <div>
                                <strong>PIN:</strong> {grp.security_pin}
                              </div>
                            )}
                            {grp.voucher_amount_cents != null && (
                              <div>
                                <strong>Amount:</strong> $
                                {(grp.voucher_amount_cents / 100).toFixed(2)}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Action buttons */}
                        <div
                          style={{
                            marginTop: "auto",
                            display: "flex",
                            gap: "8px",
                            flexWrap: "wrap",
                            paddingTop: "8px",
                          }}
                        >
                          {isAdmin && (
                            <button
                              type="button"
                              className="secondary-button"
                              style={{ fontSize: "0.78rem", padding: "4px 8px" }}
                              disabled={actionBusy}
                              onClick={() =>
                                setAssignModalGroup({
                                  activity: act,
                                  group: grp,
                                })
                              }
                            >
                              Assign Campers
                            </button>
                          )}
                          {canDeleteGroup && (
                            <button
                              type="button"
                              style={{
                                fontSize: "0.78rem",
                                padding: "4px 8px",
                                background: "#fff1f2",
                                color: "#e11d48",
                                border: "1px solid #fecdd3",
                                borderRadius: "4px",
                                cursor: "pointer",
                              }}
                              disabled={actionBusy}
                              onClick={() => handleDeleteGroup(act.id, grp.id, cardTitle)}
                            >
                              Delete Vehicle
                            </button>
                          )}
                          {canEnterVoucher && (
                            <button
                              type="button"
                              className="secondary-button"
                              style={{ fontSize: "0.78rem", padding: "4px 8px", flex: 1 }}
                              onClick={() =>
                                setVoucherModalGroup({
                                  activity: act,
                                  group: grp,
                                })
                              }
                            >
                              + Enter Voucher Details
                            </button>
                          )}
                          {isUserInGroup && (
                            <button
                              type="button"
                              className="secondary-button"
                              style={{ fontSize: "0.78rem", padding: "4px 8px", flex: 1 }}
                              disabled={Boolean(act.is_pairings_locked)}
                              title={
                                act.is_pairings_locked
                                  ? "Pairings are locked"
                                  : "Request partner swap"
                              }
                              onClick={() =>
                                setSwapModalState({
                                  activity: act,
                                  group: grp,
                                })
                              }
                            >
                              ⇄ Request Swap
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  };

                  if (isAdmin || isAccountant) {
                    return (
                      <div style={{ marginTop: "16px" }}>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            marginBottom: "10px",
                          }}
                        >
                          <h4
                            style={{
                              margin: 0,
                              fontSize: "1.05rem",
                              fontWeight: 700,
                              color: "#0f172a",
                            }}
                          >
                            🏎️ Vehicle Pairings ({(act.groups || []).length})
                          </h4>
                        </div>

                        {(act.groups || []).length === 0 ? (
                          <div
                            style={{
                              padding: "16px",
                              textAlign: "center",
                              color: "#64748b",
                              fontSize: "0.9rem",
                              border: "1px dashed #cbd5e1",
                              borderRadius: "8px",
                            }}
                          >
                            No vehicle pairings created yet.
                          </div>
                        ) : (
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns:
                                "repeat(auto-fill, minmax(min(100%, 280px), 1fr))",
                              gap: "14px",
                            }}
                          >
                            {(act.groups || []).map((grp) => renderGroupCard(grp))}
                          </div>
                        )}
                      </div>
                    );
                  }

                  // Non-admin camper view: show vehicles they are riding in OR designated purchaser for
                  const myGroups = (act.groups || []).filter(
                    (g) =>
                      (g.members || []).some((m) => m.member_id === currentMemberId) ||
                      (Boolean(currentMemberId) && g.purchaser_member_id === currentMemberId)
                  );

                  if (myGroups.length > 0) {
                    return (
                      <div style={{ marginTop: "16px" }}>
                        <h4
                          style={{
                            margin: "0 0 10px 0",
                            fontSize: "1.05rem",
                            fontWeight: 700,
                            color: "#0f172a",
                          }}
                        >
                          🏎️ {myGroups.length === 1 ? "Your Assigned Vehicle" : `Your Vehicles (${myGroups.length})`}
                        </h4>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns:
                              "repeat(auto-fill, minmax(min(100%, 320px), 1fr))",
                            gap: "14px",
                          }}
                        >
                          {myGroups.map((grp) => renderGroupCard(grp))}
                        </div>
                      </div>
                    );
                  }

                  if (isAttending) {
                    return (
                      <div
                        style={{
                          marginTop: "16px",
                          padding: "16px 20px",
                          background: "#f0fdf4",
                          border: "1px solid #bbf7d0",
                          borderLeft: "4px solid #22c55e",
                          borderRadius: "8px",
                          color: "#166534",
                          fontWeight: 600,
                          fontSize: "0.95rem",
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                        }}
                      >
                        <span>🚗</span>
                        <span>
                          You are confirmed for this tour! The trip organizer will assign your vehicle shortly.
                        </span>
                      </div>
                    );
                  }

                  if (isOptedOut) {
                    return (
                      <div
                        style={{
                          marginTop: "16px",
                          padding: "16px 20px",
                          background: "#f8fafc",
                          border: "1px solid #e2e8f0",
                          borderLeft: "4px solid #64748b",
                          borderRadius: "8px",
                          color: "#475569",
                          fontWeight: 600,
                          fontSize: "0.95rem",
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                        }}
                      >
                        <span>🏕️</span>
                        <span>You have opted out of this tour (relaxing at campsite).</span>
                      </div>
                    );
                  }

                  return null;
                })()}
              </div>
            </div>
          );
        })
      )}

      {/* VOUCHER MODAL */}
      {voucherModalGroup && (
        <VoucherModal
          activity={voucherModalGroup.activity}
          group={voucherModalGroup.group}
          attendeesList={attendeesList}
          currentMemberId={currentMemberId}
          busy={actionBusy}
          onClose={() => setVoucherModalGroup(null)}
          onSubmit={(data) =>
            handleSubmitVoucher(voucherModalGroup.activity, voucherModalGroup.group, data)
          }
        />
      )}

      {/* TOUR OPERATOR CALL SHEET MODAL */}
      {callSheetActivity && (
        <CallSheetModal
          activity={callSheetActivity}
          attendeesList={attendeesList}
          copied={callSheetCopied}
          onCopy={() => setCallSheetCopied(true)}
          onClose={() => setCallSheetActivity(null)}
        />
      )}

      {/* PARTNER SWAP MODAL */}
      {swapModalState && (
        <PartnerSwapModal
          activity={swapModalState.activity}
          group={swapModalState.group}
          currentMemberId={currentMemberId}
          busy={actionBusy}
          onClose={() => setSwapModalState(null)}
          onSubmit={(targetMemberId) =>
            handleRequestSwap(swapModalState.activity.id, targetMemberId)
          }
        />
      )}

      {/* ASSIGN CAMPERS MODAL (ADMIN) */}
      {assignModalGroup && (
        <AssignCampersModal
          activity={assignModalGroup.activity}
          group={assignModalGroup.group}
          tripAttendees={tripAttendees}
          busy={actionBusy}
          onClose={() => setAssignModalGroup(null)}
          onSubmit={(memberIds) =>
            handleAssignMembers(
              assignModalGroup.activity.id,
              assignModalGroup.group.id,
              memberIds
            )
          }
        />
      )}

      {/* ADD ACTIVITY MODAL (ADMIN) */}
      {addModalOpen && (
        <AddActivityModal
          tripId={tripId}
          api={api}
          onClose={() => setAddModalOpen(false)}
          onSuccess={async () => {
            setAddModalOpen(false);
            await refreshAll();
          }}
        />
      )}

      {/* EDIT ACTIVITY MODAL (ADMIN) */}
      {editingActivity && (
        <EditActivityModal
          tripId={tripId}
          activity={editingActivity}
          api={api}
          onClose={() => setEditingActivity(null)}
          onSuccess={async () => {
            setEditingActivity(null);
            await refreshAll();
          }}
        />
      )}
    </div>
  );
}

// -------------------------------------------------------------
// VOUCHER MODAL
// -------------------------------------------------------------
function VoucherModal({
  activity,
  group,
  attendeesList = [],
  currentMemberId = "",
  busy,
  onClose,
  onSubmit,
}: {
  activity: TripActivityItem;
  group: TripActivityGroup;
  attendeesList?: Array<{ memberId: string; displayName: string }>;
  currentMemberId?: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (data: {
    purchaserMemberId?: string;
    purchaseDate: string;
    orderNumber: string;
    voucherCode: string;
    securityPin: string;
    amountDollars: string;
  }) => void;
}) {
  const groupLabel = group.group_name || `${activity.unit_label || "Vehicle"} #${group.group_number}`;
  const [purchaserMemberId, setPurchaserMemberId] = useState<string>(
    group.purchaser_member_id || (group.members?.[0]?.member_id) || currentMemberId
  );
  const [purchaseDate, setPurchaseDate] = useState(
    group.purchase_date || new Date().toISOString().slice(0, 10)
  );
  const [orderNumber, setOrderNumber] = useState(
    group.order_number || group.order_reference_number || ""
  );
  const [voucherCode, setVoucherCode] = useState(group.voucher_code || "");
  const [securityPin, setSecurityPin] = useState(group.security_pin || "");
  const [amountDollars, setAmountDollars] = useState(
    group.voucher_amount_cents != null
      ? (group.voucher_amount_cents / 100).toFixed(2)
      : group.amount_cents != null
      ? (group.amount_cents / 100).toFixed(2)
      : ""
  );
  const [formErr, setFormErr] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!orderNumber.trim() && !voucherCode.trim()) {
      setFormErr("Please enter at least an Order Number or Voucher Code.");
      return;
    }
    onSubmit({
      purchaserMemberId,
      purchaseDate,
      orderNumber,
      voucherCode,
      securityPin,
      amountDollars,
    });
  }

  return (
    <div className="modal-backdrop">
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={`Enter Voucher Details - ${groupLabel}`}
        style={{ maxWidth: "520px", width: "95%" }}
      >
        <h3 style={{ margin: "0 0 10px 0" }}>Enter Voucher Details - {groupLabel}</h3>

        <div
          style={{
            background: "#eff6ff",
            border: "1px solid #bfdbfe",
            color: "#1e40af",
            padding: "10px 14px",
            borderRadius: "6px",
            fontSize: "0.85rem",
            lineHeight: 1.4,
            marginBottom: "14px",
          }}
        >
          💰 <em>Entering this cost will automatically post a shared trip expense to the ledger, split dynamically among all attending participants!</em>
        </div>

        {formErr && (
          <p role="alert" className="form-error" style={{ marginBottom: "12px" }}>
            {formErr}
          </p>
        )}

        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", flexDirection: "column", gap: "12px" }}
        >
          {attendeesList.length > 0 && (
            <label>
              Who Paid / Purchased?
              <select
                value={purchaserMemberId}
                onChange={(e) => setPurchaserMemberId(e.target.value)}
                disabled={busy}
              >
                {attendeesList.map((att) => (
                  <option key={att.memberId} value={att.memberId}>
                    {att.displayName} {att.memberId === currentMemberId ? "(You)" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label>
            Purchase Date
            <input
              type="date"
              value={purchaseDate}
              onChange={(e) => setPurchaseDate(e.target.value)}
              required
            />
          </label>

          <label>
            Groupon Order / Ref #
            <input
              type="text"
              placeholder="e.g. ORD-9988"
              value={orderNumber}
              onChange={(e) => setOrderNumber(e.target.value)}
            />
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
            <label>
              Redemption / Voucher Code
              <input
                type="text"
                placeholder="e.g. GP-12345"
                value={voucherCode}
                onChange={(e) => setVoucherCode(e.target.value)}
              />
            </label>
            <label>
              Security Code / PIN
              <input
                type="text"
                placeholder="e.g. 9876"
                value={securityPin}
                onChange={(e) => setSecurityPin(e.target.value)}
              />
            </label>
          </div>

          <label>
            Amount in Dollars
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder="174.60"
              value={amountDollars}
              onChange={(e) => setAmountDollars(e.target.value)}
            />
          </label>

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: "8px",
              marginTop: "12px",
              paddingTop: "12px",
              borderTop: "1px solid #e2e8f0",
            }}
          >
            <button
              type="button"
              className="secondary-button"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </button>
            <button type="submit" className="primary-button" disabled={busy}>
              {busy ? "Saving…" : "Save Voucher"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// CALL SHEET MODAL
// -------------------------------------------------------------
function CallSheetModal({
  activity,
  attendeesList = [],
  copied,
  onCopy,
  onClose,
}: {
  activity: TripActivityItem;
  attendeesList?: Array<{ memberId: string; displayName: string }>;
  copied: boolean;
  onCopy: () => void;
  onClose: () => void;
}) {
  const schedule = formatActivitySchedule(
    activity.activity_date,
    activity.start_time,
    activity.end_time
  );

  async function handleCopy() {
    const lines = [
      `Tour Operator Call Sheet: ${activity.title}`,
      `Schedule: ${schedule}`,
      `Location: ${[activity.location_name, activity.address].filter(Boolean).join(" • ")}`,
      activity.waiver_url ? `Waiver URL: ${activity.waiver_url}` : "",
      "",
      activity.waiver_url
        ? "Vehicle\tAssigned Riders (Waiver Status)\tPurchaser\tOrder #\tVoucher Code\tSecurity PIN\tStatus"
        : "Vehicle\tAssigned Riders\tPurchaser\tOrder #\tVoucher Code\tSecurity PIN\tStatus",
    ].filter(Boolean);

    for (const g of activity.groups || []) {
      const vLabel = g.group_name || `${activity.unit_label || "Vehicle"} #${g.group_number}`;
      const riders = (g.members || []).map((m) => {
        if (!activity.waiver_url) return m.display_name;
        const p = (activity.participants || []).find((part) => part.member_id === m.member_id);
        const wStatus = p?.waiver_signed_at ? "✓ Signed" : p?.waiver_clicked_at ? "⏳ Clicked" : "⚠️ Pending";
        return `${m.display_name} (${wStatus})`;
      }).join(", ") || "None";
      const purchaser =
        g.purchaser_display_name ||
        attendeesList.find((a) => a.memberId === g.purchaser_member_id)?.displayName ||
        "-";
      const order = g.order_number || g.order_reference_number || "-";
      const code = g.voucher_code || (g.voucher_status === "purchased" ? "Masked" : "-");
      const pin = g.security_pin || "-";
      const status = g.voucher_status || "-";
      lines.push(`${vLabel}\t${riders}\t${purchaser}\t${order}\t${code}\t${pin}\t${status}`);
    }

    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      onCopy();
    } catch (err) {
      console.error("Clipboard copy failed:", err);
    }
  }

  return (
    <div className="modal-backdrop">
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={`Tour Operator Call Sheet - ${activity.title}`}
        style={{ maxWidth: "800px", width: "95%" }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: "12px",
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: "1.2rem" }}>
              📞 Tour Operator Call Sheet - {activity.title}
            </h3>
            <p style={{ margin: "4px 0 0 0", color: "#64748b", fontSize: "0.85rem" }}>
              Manifest and voucher verification sheet for contacting the tour operator.
            </p>
          </div>
          <button
            type="button"
            className="secondary-button"
            style={{ fontSize: "0.85rem" }}
            onClick={onClose}
          >
            ✕ Close
          </button>
        </div>

        <div style={{ overflowX: "auto", margin: "14px 0" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "0.85rem",
              textAlign: "left",
            }}
          >
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "2px solid #e2e8f0" }}>
                <th style={{ padding: "8px 10px" }}>Vehicle #</th>
                <th style={{ padding: "8px 10px" }}>Assigned Riders</th>
                <th style={{ padding: "8px 10px" }}>Purchaser</th>
                <th style={{ padding: "8px 10px" }}>Order #</th>
                <th style={{ padding: "8px 10px" }}>Voucher Code</th>
                <th style={{ padding: "8px 10px" }}>Security PIN</th>
                <th style={{ padding: "8px 10px" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {(activity.groups || []).map((g) => {
                const vLabel = g.group_name || `${activity.unit_label || "Vehicle"} #${g.group_number}`;
                return (
                  <tr key={g.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "8px 10px", fontWeight: 600 }}>{vLabel}</td>
                    <td style={{ padding: "8px 10px" }}>
                      {(g.members || []).length > 0 ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                          {(g.members || []).map((m) => {
                            const p = (activity.participants || []).find((part) => part.member_id === m.member_id);
                            const isSigned = Boolean(p?.waiver_signed_at);
                            const isClicked = Boolean(p?.waiver_clicked_at);
                            return (
                              <div key={m.member_id} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                <span>{m.display_name}</span>
                                {activity.waiver_url && (
                                  <span
                                    data-testid={`rider-waiver-status-${m.member_id}`}
                                    style={{
                                      fontSize: "0.72rem",
                                      fontWeight: 600,
                                      padding: "1px 5px",
                                      borderRadius: "4px",
                                      background: isSigned ? "#dcfce7" : isClicked ? "#fef3c7" : "#fee2e2",
                                      color: isSigned ? "#166534" : isClicked ? "#92400e" : "#991b1b",
                                    }}
                                  >
                                    {isSigned ? "✓ Signed" : isClicked ? "⏳ Clicked" : "⚠️ Pending"}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        "None"
                      )}
                    </td>
                    <td style={{ padding: "8px 10px" }}>
                      {g.purchaser_display_name ||
                        attendeesList.find((a) => a.memberId === g.purchaser_member_id)?.displayName ||
                        "-"}
                    </td>
                    <td style={{ padding: "8px 10px" }}>
                      {g.order_number || g.order_reference_number || "-"}
                    </td>
                    <td style={{ padding: "8px 10px", fontFamily: "monospace" }}>
                      {g.voucher_code || (g.voucher_status === "purchased" ? "Masked" : "-")}
                    </td>
                    <td style={{ padding: "8px 10px", fontFamily: "monospace" }}>
                      {g.security_pin || "-"}
                    </td>
                    <td style={{ padding: "8px 10px" }}>
                      <span
                        style={{
                          fontSize: "0.75rem",
                          fontWeight: 600,
                          padding: "2px 6px",
                          borderRadius: "4px",
                          background:
                            g.voucher_status === "purchased" || g.voucher_status === "verified"
                              ? "#dcfce7"
                              : "#fef3c7",
                          color:
                            g.voucher_status === "purchased" || g.voucher_status === "verified"
                              ? "#166534"
                              : "#92400e",
                        }}
                      >
                        {g.voucher_status || "-"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Participant Waiver Completion Roster */}
        {activity.waiver_url && (
          <div style={{ margin: "20px 0 10px 0" }}>
            <h4 style={{ margin: "0 0 8px 0", fontSize: "0.95rem", color: "#334155" }}>
              📝 Participant Waiver Completion Roster ({activity.participants?.filter((p) => p.status === "attending" && p.waiver_signed_at).length || 0}/{activity.participants?.filter((p) => p.status === "attending").length || 0} Signed)
            </h4>
            <div style={{ overflowX: "auto" }}>
              <table
                data-testid="call-sheet-waiver-roster"
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: "0.82rem",
                  textAlign: "left",
                }}
              >
                <thead>
                  <tr style={{ background: "#f8fafc", borderBottom: "1.5px solid #e2e8f0" }}>
                    <th style={{ padding: "6px 8px" }}>Camper</th>
                    <th style={{ padding: "6px 8px" }}>Waiver Status</th>
                    <th style={{ padding: "6px 8px" }}>Clicked At</th>
                    <th style={{ padding: "6px 8px" }}>Signed / Confirmed At</th>
                  </tr>
                </thead>
                <tbody>
                  {(activity.participants || [])
                    .filter((p) => p.status === "attending")
                    .map((p) => {
                      const isSigned = Boolean(p.waiver_signed_at);
                      const isClicked = Boolean(p.waiver_clicked_at);
                      return (
                        <tr key={p.member_id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                          <td style={{ padding: "6px 8px", fontWeight: 500 }}>{p.display_name}</td>
                          <td style={{ padding: "6px 8px" }}>
                            <span
                              style={{
                                fontSize: "0.75rem",
                                fontWeight: 600,
                                padding: "2px 6px",
                                borderRadius: "4px",
                                background: isSigned ? "#dcfce7" : isClicked ? "#fef3c7" : "#fee2e2",
                                color: isSigned ? "#166534" : isClicked ? "#92400e" : "#991b1b",
                              }}
                            >
                              {isSigned ? "✓ Signed" : isClicked ? "⏳ Clicked" : "⚠️ Pending"}
                            </span>
                          </td>
                          <td style={{ padding: "6px 8px", color: "#64748b" }}>
                            {p.waiver_clicked_at ? new Date(p.waiver_clicked_at).toLocaleString() : "-"}
                          </td>
                          <td style={{ padding: "6px 8px", color: "#64748b" }}>
                            {p.waiver_signed_at ? new Date(p.waiver_signed_at).toLocaleString() : "-"}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: "16px",
            paddingTop: "12px",
            borderTop: "1px solid #e2e8f0",
          }}
        >
          {copied ? (
            <span style={{ color: "#16a34a", fontWeight: 600, fontSize: "0.9rem" }}>
              ✓ Copied to Clipboard!
            </span>
          ) : (
            <span />
          )}

          <div style={{ display: "flex", gap: "8px" }}>
            <button
              type="button"
              className="primary-button"
              style={{ fontSize: "0.85rem", padding: "6px 14px" }}
              onClick={handleCopy}
            >
              📋 Copy All to Clipboard
            </button>
            <button
              type="button"
              className="secondary-button"
              style={{ fontSize: "0.85rem", padding: "6px 12px" }}
              onClick={onClose}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// PARTNER SWAP MODAL
// -------------------------------------------------------------
function PartnerSwapModal({
  activity,
  group,
  currentMemberId,
  busy,
  onClose,
  onSubmit,
}: {
  activity: TripActivityItem;
  group: TripActivityGroup;
  currentMemberId?: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (targetMemberId: string) => void;
}) {
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const unitLabel = activity.unit_label || "Vehicle";

  // List members in OTHER groups
  const otherCandidates: Array<{
    memberId: string;
    displayName: string;
    groupLabel: string;
  }> = [];

  for (const g of activity.groups || []) {
    if (g.id === group.id) continue;
    const gLabel = g.group_name || `${unitLabel} #${g.group_number}`;
    for (const m of g.members || []) {
      if (m.member_id !== currentMemberId) {
        otherCandidates.push({
          memberId: m.member_id,
          displayName: m.display_name || "Unknown",
          groupLabel: gLabel,
        });
      }
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedMemberId) return;
    onSubmit(selectedMemberId);
  }

  return (
    <div className="modal-backdrop">
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label="Request Partner Swap"
        style={{ maxWidth: "480px", width: "95%" }}
      >
        <h3 style={{ margin: "0 0 8px 0" }}>⇄ Request Partner Swap</h3>
        <p style={{ margin: "0 0 14px 0", color: "#64748b", fontSize: "0.85rem" }}>
          Choose an attendee currently assigned to another vehicle to request a pairing swap with.
          Both you and the selected attendee must approve before vehicles switch.
        </p>

        {otherCandidates.length === 0 ? (
          <p style={{ fontStyle: "italic", color: "#64748b" }}>
            No other assigned attendees available to swap with.
          </p>
        ) : (
          <form
            onSubmit={handleSubmit}
            style={{ display: "flex", flexDirection: "column", gap: "12px" }}
          >
            <label>
              Select Member to Swap With
              <select
                value={selectedMemberId}
                onChange={(e) => setSelectedMemberId(e.target.value)}
                required
              >
                <option value="">-- Select Member --</option>
                {otherCandidates.map((c) => (
                  <option key={c.memberId} value={c.memberId}>
                    {c.displayName} ({c.groupLabel})
                  </option>
                ))}
              </select>
            </label>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "8px",
                marginTop: "12px",
                paddingTop: "12px",
                borderTop: "1px solid #e2e8f0",
              }}
            >
              <button
                type="button"
                className="secondary-button"
                onClick={onClose}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="primary-button"
                disabled={busy || !selectedMemberId}
              >
                {busy ? "Sending…" : "Send Swap Request"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// ASSIGN CAMPERS MODAL (ADMIN)
// -------------------------------------------------------------
function AssignCampersModal({
  activity,
  group,
  tripAttendees,
  busy,
  onClose,
  onSubmit,
}: {
  activity: TripActivityItem;
  group: TripActivityGroup;
  tripAttendees?: Array<{ memberId: string; displayName: string }>;
  busy: boolean;
  onClose: () => void;
  onSubmit: (memberIds: string[]) => void;
}) {
  const groupLabel =
    group.group_name || `${activity.unit_label || "Vehicle"} #${group.group_number}`;
  const capacity = group.capacity || activity.unit_capacity || 2;

  // Build list of all campers eligible for vehicle assignment:
  // 1. Confirmed trip attendees
  // 2. Activity participants who have status === "attending"
  // 3. Existing members in this group
  // Exclude anyone who has status === "opted_out"
  const optedOutIds = new Set(
    (activity.participants || [])
      .filter((p) => p.status === "opted_out")
      .map((p) => p.member_id)
  );

  const eligibleMap = new Map<string, string>();
  for (const p of activity.participants || []) {
    if (p.status === "attending" && p.member_id) {
      eligibleMap.set(p.member_id, p.display_name || "Camper");
    }
  }
  for (const a of tripAttendees || []) {
    if (!optedOutIds.has(a.memberId)) {
      eligibleMap.set(a.memberId, a.displayName || "Camper");
    }
  }
  for (const a of activity.trip_attendees || []) {
    if (!optedOutIds.has(a.member_id)) {
      eligibleMap.set(a.member_id, a.display_name || "Camper");
    }
  }
  for (const m of group.members || []) {
    if (m.member_id && !optedOutIds.has(m.member_id)) {
      eligibleMap.set(m.member_id, m.display_name || "Camper");
    }
  }

  // Map each member to their currently assigned vehicle in this activity
  const memberVehicleMap = new Map<string, string>();
  for (const g of activity.groups || []) {
    const vLabel = g.group_name || `${activity.unit_label || "Vehicle"} #${g.group_number}`;
    for (const m of g.members || []) {
      memberVehicleMap.set(m.member_id, vLabel);
    }
  }

  const eligibleCampers = Array.from(eligibleMap.entries())
    .map(([member_id, display_name]) => ({
      member_id,
      display_name,
      assignedVehicle: memberVehicleMap.get(member_id) || null,
    }))
    .sort((a, b) => a.display_name.localeCompare(b.display_name));

  const [slots, setSlots] = useState<string[]>(() => {
    const initial = Array(capacity).fill("");
    const existing = group.members || [];
    for (let i = 0; i < capacity && i < existing.length; i++) {
      initial[i] = existing[i].member_id;
    }
    return initial;
  });

  function handleSlotChange(index: number, value: string) {
    setSlots((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const selectedMemberIds = slots.filter(Boolean);
    onSubmit(selectedMemberIds);
  }

  return (
    <div className="modal-backdrop">
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={`Assign Campers - ${groupLabel}`}
        style={{ maxWidth: "480px", width: "95%" }}
      >
        <h3 style={{ margin: "0 0 8px 0" }}>Assign Campers - {groupLabel}</h3>
        <p style={{ margin: "0 0 14px 0", color: "#64748b", fontSize: "0.85rem" }}>
          Select attending campers to assign to each slot in this {activity.unit_label || "vehicle"}.
        </p>

        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", flexDirection: "column", gap: "12px" }}
        >
          {Array.from({ length: capacity }).map((_, idx) => (
            <label key={idx}>
              Slot {idx + 1}
              <select
                value={slots[idx] || ""}
                onChange={(e) => handleSlotChange(idx, e.target.value)}
                aria-label={`Slot ${idx + 1}`}
              >
                <option value="">(Empty / Open Spot)</option>
                {eligibleCampers.map((c) => {
                  let suffix = " (Unassigned)";
                  if (c.assignedVehicle) {
                    suffix = c.assignedVehicle === groupLabel ? " (Assigned here)" : ` (${c.assignedVehicle})`;
                  }
                  return (
                    <option key={c.member_id} value={c.member_id}>
                      {c.display_name}{suffix}
                    </option>
                  );
                })}
              </select>
            </label>
          ))}

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: "8px",
              marginTop: "12px",
              paddingTop: "12px",
              borderTop: "1px solid #e2e8f0",
            }}
          >
            <button
              type="button"
              className="secondary-button"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </button>
            <button type="submit" className="primary-button" disabled={busy}>
              {busy ? "Saving…" : "Save Assignments"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// ADD / CLONE ACTIVITY MODAL (ADMIN)
// -------------------------------------------------------------
function AddActivityModal({
  tripId,
  api,
  onClose,
  onSuccess,
}: {
  tripId: string;
  api: TripApiType;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}) {
  const [tab, setTab] = useState<"clone" | "create">("clone");
  const [masterList, setMasterList] = useState<any[]>([]);
  const [loadingMaster, setLoadingMaster] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Clone fields
  const [selectedMasterId, setSelectedMasterId] = useState("");
  const [activityDate, setActivityDate] = useState("");
  const [startTime, setStartTime] = useState("10:00");
  const [endTime, setEndTime] = useState("17:00");

  // Create custom fields
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("tour");
  const [unitLabel, setUnitLabel] = useState("Vehicle");
  const [unitCapacity, setUnitCapacity] = useState("2");
  const [locationName, setLocationName] = useState("");
  const [address, setAddress] = useState("");
  const [directionsUrl, setDirectionsUrl] = useState("");
  const [bookingUrl, setBookingUrl] = useState("");
  const [waiverUrl, setWaiverUrl] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [dealStrategyTip, setDealStrategyTip] = useState("");

  useEffect(() => {
    async function loadMaster() {
      setLoadingMaster(true);
      try {
        const res = await api<{ activities?: any[] }>("get_master_activities", {});
        setMasterList(res?.activities || []);
        if (res?.activities && res.activities.length > 0) {
          setSelectedMasterId(res.activities[0].id);
        }
      } catch (err: any) {
        console.error("Failed to load master activities:", err);
      } finally {
        setLoadingMaster(false);
      }
    }
    void loadMaster();
  }, []);

  async function handleClone(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedMasterId || !activityDate) {
      setError("Please select an activity template and date.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api("admin_manage_trip_activity", {
        action: "clone_from_master",
        tripId,
        masterActivityId: selectedMasterId,
        activityDate,
        startTime: startTime ? `${startTime}:00` : undefined,
        endTime: endTime ? `${endTime}:00` : undefined,
      });
      await onSuccess();
    } catch (err: any) {
      console.error("Clone activity failed:", err);
      setError(err?.message || "Failed to clone activity.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !activityDate) {
      setError("Please provide a title and date.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api("admin_manage_trip_activity", {
        action: "create",
        tripId,
        title: title.trim(),
        category,
        activityDate,
        startTime: startTime ? `${startTime}:00` : undefined,
        endTime: endTime ? `${endTime}:00` : undefined,
        unitLabel: unitLabel.trim() || "Vehicle",
        unitCapacity: parseInt(unitCapacity, 10) || 2,
        locationName: locationName.trim() || undefined,
        address: address.trim() || undefined,
        directionsUrl: directionsUrl.trim() || undefined,
        bookingUrl: bookingUrl.trim() || undefined,
        waiverUrl: waiverUrl.trim() || undefined,
        imageUrl: imageUrl.trim() || undefined,
        dealStrategyTip: dealStrategyTip.trim() || undefined,
      });
      await onSuccess();
    } catch (err: any) {
      console.error("Create activity failed:", err);
      setError(err?.message || "Failed to create custom activity.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label="Add Trip Activity"
        style={{ maxWidth: "540px", width: "95%" }}
      >
        <h3 style={{ margin: "0 0 12px 0" }}>Add Activity to Trip</h3>

        {/* Tab switch */}
        <div style={{ display: "flex", gap: "8px", marginBottom: "14px" }}>
          <button
            type="button"
            className={tab === "clone" ? "primary-button" : "secondary-button"}
            style={{ fontSize: "0.85rem", padding: "6px 12px" }}
            onClick={() => setTab("clone")}
          >
            Clone from Master Catalog
          </button>
          <button
            type="button"
            className={tab === "create" ? "primary-button" : "secondary-button"}
            style={{ fontSize: "0.85rem", padding: "6px 12px" }}
            onClick={() => setTab("create")}
          >
            Create Custom Activity
          </button>
        </div>

        {error && (
          <p role="alert" className="form-error" style={{ marginBottom: "12px" }}>
            {error}
          </p>
        )}

        {tab === "clone" ? (
          loadingMaster ? (
            <p>Loading master catalog…</p>
          ) : masterList.length === 0 ? (
            <p style={{ color: "#64748b" }}>
              No master activity templates found. Please create a custom activity instead.
            </p>
          ) : (
            <form
              onSubmit={handleClone}
              style={{ display: "flex", flexDirection: "column", gap: "12px" }}
            >
              <label>
                Select Activity Template *
                <select
                  value={selectedMasterId}
                  onChange={(e) => setSelectedMasterId(e.target.value)}
                  required
                >
                  {masterList.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.title} ({m.unit_label || "Vehicle"}, cap {m.unit_capacity || 2})
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Activity Date *
                <input
                  type="date"
                  value={activityDate}
                  onChange={(e) => setActivityDate(e.target.value)}
                  required
                />
              </label>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                <label>
                  Start Time
                  <input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                  />
                </label>
                <label>
                  End Time
                  <input
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                  />
                </label>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "8px",
                  marginTop: "12px",
                  paddingTop: "12px",
                  borderTop: "1px solid #e2e8f0",
                }}
              >
                <button
                  type="button"
                  className="secondary-button"
                  onClick={onClose}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button type="submit" className="primary-button" disabled={busy}>
                  {busy ? "Cloning…" : "Add to Trip"}
                </button>
              </div>
            </form>
          )
        ) : (
          <form
            onSubmit={handleCreate}
            style={{ display: "flex", flexDirection: "column", gap: "12px" }}
          >
            <label>
              Activity Title *
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Monterey Whale Watching"
                required
              />
            </label>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <label>
                Category
                <select value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="tour">🗺️ Tour</option>
                  <option value="water">🛶 Water</option>
                  <option value="outdoor">🏔️ Outdoor</option>
                  <option value="entertainment">🎪 Entertainment</option>
                  <option value="other">🎯 Other</option>
                </select>
              </label>
              <label>
                Activity Date *
                <input
                  type="date"
                  value={activityDate}
                  onChange={(e) => setActivityDate(e.target.value)}
                  required
                />
              </label>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <label>
                Start Time
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
              </label>
              <label>
                End Time
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                />
              </label>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <label>
                Unit Label
                <input
                  type="text"
                  value={unitLabel}
                  onChange={(e) => setUnitLabel(e.target.value)}
                  placeholder="e.g. GoCar, Kayak, Boat"
                />
              </label>
              <label>
                Unit Capacity
                <input
                  type="number"
                  min="1"
                  value={unitCapacity}
                  onChange={(e) => setUnitCapacity(e.target.value)}
                />
              </label>
            </div>

            <label>
              Location Name
              <input
                type="text"
                value={locationName}
                onChange={(e) => setLocationName(e.target.value)}
                placeholder="e.g. Fisherman's Wharf"
              />
            </label>

            <label>
              Address
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="e.g. 510 Beach St, San Francisco, CA"
              />
            </label>

            <label>
              Directions URL
              <input
                type="url"
                value={directionsUrl}
                onChange={(e) => setDirectionsUrl(e.target.value)}
                placeholder="https://maps.google.com/..."
              />
            </label>

            <label>
              Booking / Signup URL (e.g. Groupon)
              <input
                type="url"
                value={bookingUrl}
                onChange={(e) => setBookingUrl(e.target.value)}
                placeholder="https://www.groupon.com/deals/..."
              />
            </label>

            <label>
              Activity Waiver URL (Optional)
              <input
                type="url"
                value={waiverUrl}
                onChange={(e) => setWaiverUrl(e.target.value)}
                placeholder="https://fareharbor.com/waivers?..."
              />
            </label>

            <label>
              Image URL
              <input
                type="url"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="https://images.unsplash.com/..."
              />
            </label>

            <label>
              Deal Strategy Tip
              <textarea
                value={dealStrategyTip}
                onChange={(e) => setDealStrategyTip(e.target.value)}
                placeholder="Tip for attendees on getting coupons or Groupons..."
                rows={2}
              />
            </label>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "8px",
                marginTop: "12px",
                paddingTop: "12px",
                borderTop: "1px solid #e2e8f0",
              }}
            >
              <button
                type="button"
                className="secondary-button"
                onClick={onClose}
                disabled={busy}
              >
                Cancel
              </button>
              <button type="submit" className="primary-button" disabled={busy}>
                {busy ? "Creating…" : "Create Activity"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// EDIT ACTIVITY MODAL (ADMIN)
// -------------------------------------------------------------
function EditActivityModal({
  tripId,
  activity,
  api,
  onClose,
  onSuccess,
}: {
  tripId: string;
  activity: TripActivityItem;
  api: TripApiType;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState(activity.title || "");
  const [category, setCategory] = useState(activity.category || "tour");
  const [activityDate, setActivityDate] = useState(activity.activity_date || "");
  const [startTime, setStartTime] = useState(
    activity.start_time ? activity.start_time.slice(0, 5) : "10:00"
  );
  const [endTime, setEndTime] = useState(
    activity.end_time ? activity.end_time.slice(0, 5) : "17:00"
  );
  const [unitLabel, setUnitLabel] = useState(activity.unit_label || "Vehicle");
  const [unitCapacity, setUnitCapacity] = useState(String(activity.unit_capacity || 2));
  const [locationName, setLocationName] = useState(activity.location_name || "");
  const [address, setAddress] = useState(activity.address || "");
  const [directionsUrl, setDirectionsUrl] = useState(activity.directions_url || "");
  const [bookingUrl, setBookingUrl] = useState(
    activity.booking_url ||
      (activity.booking_notes && /^https?:\/\//i.test(activity.booking_notes.trim())
        ? activity.booking_notes.trim()
        : "")
  );
  const [waiverUrl, setWaiverUrl] = useState(activity.waiver_url || "");
  const [bookingNotes, setBookingNotes] = useState(activity.booking_notes || "");
  const [imageUrl, setImageUrl] = useState(activity.image_url || "");
  const [dealStrategyTip, setDealStrategyTip] = useState(activity.deal_strategy_tip || "");

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !activityDate) {
      setError("Please provide a title and date.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api("admin_manage_trip_activity", {
        action: "update",
        tripId,
        activityId: activity.id,
        title: title.trim(),
        category,
        activityDate,
        startTime: startTime ? `${startTime}:00` : undefined,
        endTime: endTime ? `${endTime}:00` : undefined,
        unitLabel: unitLabel.trim() || "Vehicle",
        unitCapacity: parseInt(unitCapacity, 10) || 2,
        locationName: locationName.trim() || undefined,
        address: address.trim() || undefined,
        directionsUrl: directionsUrl.trim() || undefined,
        bookingUrl: bookingUrl.trim() || undefined,
        waiverUrl: waiverUrl.trim() || undefined,
        bookingNotes: bookingNotes.trim() || undefined,
        imageUrl: imageUrl.trim() || undefined,
        dealStrategyTip: dealStrategyTip.trim() || undefined,
      });
      await onSuccess();
    } catch (err: any) {
      console.error("Update activity failed:", err);
      setError(err?.message || "Failed to update activity.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label="Edit Trip Activity"
        style={{ maxWidth: "540px", width: "95%" }}
      >
        <h3 style={{ margin: "0 0 12px 0" }}>Edit Trip Activity</h3>
        {error && (
          <p role="alert" className="form-error" style={{ marginBottom: "12px" }}>
            {error}
          </p>
        )}
        <form onSubmit={handleUpdate} className="stack" style={{ gap: "10px" }}>
          <label>
            Activity Title *
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. GoCar Monterey Tours"
            />
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
            <label>
              Category
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                {Object.entries(ACTIVITY_CATEGORIES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.icon} {v.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Date *
              <input
                type="date"
                required
                value={activityDate}
                onChange={(e) => setActivityDate(e.target.value)}
              />
            </label>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
            <label>
              Start Time
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </label>
            <label>
              End Time
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </label>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "8px" }}>
            <label>
              Unit Label
              <input
                type="text"
                value={unitLabel}
                onChange={(e) => setUnitLabel(e.target.value)}
                placeholder="e.g. GoCar, Kayak, Boat"
              />
            </label>
            <label>
              Capacity / Unit
              <input
                type="number"
                min="1"
                max="20"
                value={unitCapacity}
                onChange={(e) => setUnitCapacity(e.target.value)}
              />
            </label>
          </div>

          <label>
            Location / Departure Point Name
            <input
              type="text"
              value={locationName}
              onChange={(e) => setLocationName(e.target.value)}
              placeholder="e.g. GoCar Monterey Departures"
            />
          </label>

          <label>
            Physical Address
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="e.g. 791 Foam St, Monterey, CA 93940"
            />
          </label>

          <label>
            Google Maps / Directions URL
            <input
              type="url"
              value={directionsUrl}
              onChange={(e) => setDirectionsUrl(e.target.value)}
              placeholder="https://maps.google.com/?q=..."
            />
          </label>

          <label>
            Booking / Signup URL (e.g. Groupon)
            <input
              type="url"
              value={bookingUrl}
              onChange={(e) => setBookingUrl(e.target.value)}
              placeholder="https://www.groupon.com/deals/..."
            />
          </label>

          <label>
            Activity Waiver URL (Optional)
            <input
              type="url"
              value={waiverUrl}
              onChange={(e) => setWaiverUrl(e.target.value)}
              placeholder="https://fareharbor.com/waivers?..."
            />
          </label>

          <label>
            Booking Notes &amp; Instructions
            <textarea
              value={bookingNotes}
              onChange={(e) => setBookingNotes(e.target.value)}
              placeholder="Waiver requirements, Groupon instructions, promo codes, driver's license details..."
              rows={2}
            />
          </label>

          <label>
            Photo Image URL
            <input
              type="url"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://..."
            />
          </label>

          <label>
            Deal Strategy Tip
            <textarea
              value={dealStrategyTip}
              onChange={(e) => setDealStrategyTip(e.target.value)}
              placeholder="Tip for attendees on getting coupons or Groupons..."
              rows={2}
            />
          </label>

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: "8px",
              marginTop: "12px",
              paddingTop: "12px",
              borderTop: "1px solid #e2e8f0",
            }}
          >
            <button
              type="button"
              className="secondary-button"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </button>
            <button type="submit" className="primary-button" disabled={busy}>
              {busy ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
