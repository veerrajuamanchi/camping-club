import { useEffect, useRef, useState, useTransition } from "react";
import type { DailyWorkload } from "./DailyWorkloadProgress";
import type { TripApiType } from "./EventDetailsPage";
import type { TripTimeSlot, TripSlotDuty } from "./AdminTimeSlotManagerModal";

export type DutyAssignment = {
  id: string;
  trip_id: string;
  slot_duty_id: string;
  member_id: string;
  status: "claimed" | "assigned_by_admin" | "dropped" | "reassigned";
  claimed_at: string;
  member?: {
    member_id: string;
    display_name: string;
  };
};

export type DriverCredit = {
  id: string;
  trip_id: string;
  member_id: string;
  workload_credit: number;
  status: "approved" | "revoked";
  notes?: string | null;
};

export type QuotaProgress = {
  claimed_count: number;
  claimed_weight: number;
  driver_credit: number;
  total_score: number;
  quota_target: number;
  target_reached: boolean;
};

export type ConfirmedAttendee = {
  memberId: string;
  displayName: string;
};

export type MealHeadcounts = {
  beverages: {
    saturday: { coffee: number; tea: number; none: number };
    sunday: { coffee: number; tea: number; none: number };
  };
  meals: Array<{
    slotId: string;
    slotLabel: string;
    slotDate: string;
    vegCount: number;
    nonVegCount: number;
    skipCount: number;
    totalEating: number;
  }>;
};

type Props = {
  tripId: string;
  refreshVersion?: number;
  isConfirmedAttendee: boolean;
  isAdmin: boolean;
  currentMemberId?: string;
  api: TripApiType;
  onDutyChanged?: () => Promise<void> | void;
};

export function TripTasksAndMealsTab({
  tripId,
  refreshVersion,
  isConfirmedAttendee,
  isAdmin,
  currentMemberId,
  api,
  onDutyChanged,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [timeSlots, setTimeSlots] = useState<TripTimeSlot[]>([]);
  const [assignments, setAssignments] = useState<DutyAssignment[]>([]);
  const [driverCredits, setDriverCredits] = useState<DriverCredit[]>([]);
  const [dailyWorkload, setDailyWorkload] = useState<DailyWorkload | null>(null);
  const [dailyTargetInput, setDailyTargetInput] = useState("4");
  const [useDailyTarget, setUseDailyTarget] = useState(false);
  const [savingDailyTarget, setSavingDailyTarget] = useState(false);
  const [quotaProgress, setQuotaProgress] = useState<QuotaProgress | null>(null);
  const [attendees, setAttendees] = useState<ConfirmedAttendee[]>([]);
  const [mealHeadcounts, setMealHeadcounts] = useState<MealHeadcounts | null>(null);

  // Overlap confirmation modal state
  const [overlapDuty, setOverlapDuty] = useState<{ dutyId: string; message: string } | null>(null);

  // Admin assign modal state
  const [assigningDuty, setAssigningDuty] = useState<TripSlotDuty | null>(null);
  const [selectedMemberToAssign, setSelectedMemberToAssign] = useState<string>("");

  // Admin driver credit modal state
  const [showDriverModal, setShowDriverModal] = useState(false);
  const [driverMemberId, setDriverMemberId] = useState("");
  const [driverCreditAmount, setDriverCreditAmount] = useState<number>(1.0);
  const [driverNotes, setDriverNotes] = useState("");

  const [isPending, startTransition] = useTransition();

  const latestLoad = useRef(0);
  const loadData = async () => {
    const loadId = ++latestLoad.current;
    try {
      const data = await api<{
        timeSlots: TripTimeSlot[];
        activeAssignments: DutyAssignment[];
        driverCredits: DriverCredit[];
        myQuotaProgress: QuotaProgress | null;
        myDailyWorkload?: DailyWorkload;
        confirmedAttendees: ConfirmedAttendee[];
        mealHeadcounts?: MealHeadcounts;
      }>("get_trip_task_matrix", { tripId });

      if (loadId !== latestLoad.current) return;
      setTimeSlots(data.timeSlots ?? []);
      setAssignments(data.activeAssignments ?? []);
      setDriverCredits(data.driverCredits ?? []);
      setQuotaProgress(data.myQuotaProgress ?? null);
      setDailyWorkload(data.myDailyWorkload ?? null);
      setUseDailyTarget(data.myDailyWorkload?.target != null);
      setDailyTargetInput(String(data.myDailyWorkload?.target ?? 4));
      setAttendees(data.confirmedAttendees ?? []);
      setMealHeadcounts(data.mealHeadcounts ?? null);
      setErrorMsg(null);
    } catch {
      if (loadId === latestLoad.current) setErrorMsg("Failed to load meal and chore tasks.");
    } finally {
      if (loadId === latestLoad.current) setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
    return () => { latestLoad.current++; };
  }, [tripId, refreshVersion]);

  async function saveDailyTarget(event: React.FormEvent) {
    event.preventDefault();
    if (!dailyWorkload) return;
    setSavingDailyTarget(true); setErrorMsg(null); setSuccessMsg(null);
    try {
      await api("admin_set_daily_workload_target", { tripId, target: useDailyTarget ? Number(dailyTargetInput) : null, expectedVersion: dailyWorkload.tripVersion });
      await loadData();
      await onDutyChanged?.();
      setSuccessMsg("Daily workload target saved.");
    } catch { setErrorMsg("Could not save daily target. Refresh the trip and try again."); }
    finally { setSavingDailyTarget(false); }
  }

  const handleClaimDuty = async (slotDutyId: string, acknowledgeOverlap = false) => {
    setErrorMsg(null);
    setSuccessMsg(null);
    startTransition(async () => {
      try {
        const res = await api<{
          success?: boolean;
          overlap_detected?: boolean;
          message?: string;
        }>("claim_duty", { slotDutyId, acknowledgeOverlap });

        if (res?.overlap_detected) {
          setOverlapDuty({ dutyId: slotDutyId, message: res.message || "Time conflict detected." });
          return;
        }

        setOverlapDuty(null);
        setSuccessMsg("Successfully volunteered for this responsibility!");
        await loadData();
        void onDutyChanged?.();
      } catch (err: unknown) {
        const error = err as { code?: string; message?: string };
        if (error.code === "23514") {
          setErrorMsg("This responsibility is already full.");
        } else if (error.code === "23505") {
          setErrorMsg("You have already claimed this responsibility.");
        } else if (error.code === "42501") {
          setErrorMsg("Only confirmed attendees may volunteer for responsibilities.");
        } else {
          setErrorMsg(error.message || "Failed to volunteer for duty.");
        }
      }
    });
  };

  const handleDropDuty = async (assignmentId: string) => {
    if (!window.confirm("Are you sure you want to drop this responsibility? It will become open for others to claim.")) {
      return;
    }
    setErrorMsg(null);
    setSuccessMsg(null);
    startTransition(async () => {
      try {
        await api("drop_duty", { assignmentId, reason: "Member dropped from UI" });
        setSuccessMsg("Responsibility dropped successfully.");
        await loadData();
        void onDutyChanged?.();
      } catch {
        setErrorMsg("Failed to drop responsibility.");
      }
    });
  };

  const handleAdminAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assigningDuty || !selectedMemberToAssign) return;

    setErrorMsg(null);
    setSuccessMsg(null);
    startTransition(async () => {
      try {
        await api("admin_assign_duty", {
          slotDutyId: assigningDuty.id,
          memberId: selectedMemberToAssign,
        });
        setAssigningDuty(null);
        setSelectedMemberToAssign("");
        setSuccessMsg("Member assigned successfully.");
        await loadData();
        void onDutyChanged?.();
      } catch (err: unknown) {
        const error = err as { code?: string; message?: string };
        if (error.code === "23514") {
          setErrorMsg("Duty capacity reached.");
        } else if (error.code === "23505") {
          setErrorMsg("Member already holds this duty.");
        } else {
          setErrorMsg("Failed to assign member.");
        }
      }
    });
  };

  const handleSaveDriverCredit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!driverMemberId) return;

    setErrorMsg(null);
    setSuccessMsg(null);
    startTransition(async () => {
      try {
        await api("admin_set_driver_credit", {
          tripId,
          memberId: driverMemberId,
          workloadCredit: Number(driverCreditAmount),
          status: "approved",
          notes: driverNotes.trim() || undefined,
        });
        setShowDriverModal(false);
        setDriverMemberId("");
        setDriverNotes("");
        setSuccessMsg("Driver workload credit updated successfully.");
        await loadData();
      } catch {
        setErrorMsg("Failed to update driver credit.");
      }
    });
  };

  if (loading) {
    return (
      <div className="card" style={{ padding: "2rem", textAlign: "center" }}>
        <p>Loading meal &amp; chore tasks…</p>
      </div>
    );
  }

  // Active slots (enabled only)
  const enabledSlots = timeSlots.filter((s) => s.is_enabled);

  // Group slots by date
  const groupedByDate: Record<string, TripTimeSlot[]> = {};
  for (const slot of enabledSlots) {
    if (!groupedByDate[slot.slot_date]) {
      groupedByDate[slot.slot_date] = [];
    }
    groupedByDate[slot.slot_date].push(slot);
  }

  const allDateKeys = new Set([
    ...Object.keys(groupedByDate),
    ...(dailyWorkload?.days ?? []).map((d) => d.date),
  ]);
  const sortedDates = Array.from(allDateKeys).sort();

  // Count unfilled duties across enabled slots for T-48h override mode
  let unfilledDutiesCount = 0;
  for (const slot of enabledSlots) {
    for (const duty of slot.duties ?? []) {
      if (duty.is_active) {
        const claimedCount = assignments.filter((a) => a.slot_duty_id === duty.id).length;
        if (claimedCount < duty.capacity) {
          unfilledDutiesCount += duty.capacity - claimedCount;
        }
      }
    }
  }

  return (
    <div className="tasks-and-meals-tab stack" style={{ gap: "1.5rem" }}>
      {/* Alert Banners */}
      {errorMsg && (
        <div className="card form-error" role="alert" style={{ margin: 0 }}>
          {errorMsg}
        </div>
      )}
      {successMsg && (
        <div className="card" role="status" style={{ background: "#ecfdf5", borderColor: "#a7f3d0", color: "#065f46", margin: 0 }}>
          {successMsg}
        </div>
      )}

      {/* Non-attendee informational banner */}
      {!isConfirmedAttendee && (
        <div
          data-testid="not-attending-tasks-banner"
          role="status"
          style={{
            background: "#fffbeb",
            border: "1px solid #f59e0b",
            color: "#92400e",
            padding: "0.85rem 1.25rem",
            borderRadius: "8px",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            fontWeight: 500,
          }}
        >
          <span>ℹ️</span>
          <span>
            You are viewing trip responsibilities as a non-attendee. Only confirmed Going attendees can volunteer for meals and chores. (You are not currently a confirmed attendee. Please submit your RSVP as Going to volunteer for tasks.)
          </span>
        </div>
      )}

      {/* T-48h Duty Override Mode Banner */}
      {isAdmin && unfilledDutiesCount > 0 && (
        <div
          role="status"
          style={{
            background: "#fffbeb",
            border: "1px solid #f59e0b",
            color: "#92400e",
            padding: "0.85rem 1.25rem",
            borderRadius: "8px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "0.5rem",
          }}
        >
          <div>
            <strong>⚡ T-48h Duty Override Mode:</strong> There are <strong>{unfilledDutiesCount} open duty slot(s)</strong> remaining.
            As Administrator, you can force-assign campers below to ensure all meals and chores are covered before departure.
          </div>
        </div>
      )}

      {isAdmin && dailyWorkload && (
        <details className="card" style={{ marginBottom: "0.5rem" }}>
          <summary style={{ cursor: "pointer", fontWeight: 600, color: "#1e293b" }}>⚙️ Admin: Configure Daily Workload Target</summary>
          <form onSubmit={event => void saveDailyTarget(event)} style={{ marginTop: "0.75rem", display: "grid", gap: "0.75rem" }}>
            <label className="checkbox-label" style={{ minHeight: "44px", display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <input type="checkbox" checked={useDailyTarget} onChange={event => setUseDailyTarget(event.target.checked)} />
              Use a daily workload target for this trip
            </label>
            {useDailyTarget && <label>Daily workload target (×)<input type="number" min="0.5" max="100" step="0.5" required value={dailyTargetInput} onChange={event => setDailyTargetInput(event.target.value)} /></label>}
            <p style={{ margin: 0, fontSize: "0.85rem", color: "#64748b" }}>Daily targets use scheduled task weights. Members below target are excused when no eligible slots remain. RSVP stays saved.</p>
            <button disabled={savingDailyTarget} style={{ minHeight: "44px", width: "fit-content" }}>{savingDailyTarget ? "Saving…" : "Save daily target"}</button>
          </form>
        </details>
      )}
      {/* Preserve the existing trip quota until the admin opts into a daily target. */}
      {isConfirmedAttendee && dailyWorkload?.target == null && <div className="card quota-progress-card" style={{ background: "linear-gradient(135deg, #f0fdf4 0%, #e0f2fe 100%)", borderColor: "#bbf7d0" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <h3 style={{ margin: 0, fontSize: "1.2rem", color: "#0f172a" }}>Your Trip Responsibility Progress</h3>
            <p style={{ margin: "0.25rem 0 0 0", color: "#475569", fontSize: "0.95rem" }}>
              Every attendee helps keep our trip smooth! The target is{" "}
              <strong>{quotaProgress?.quota_target ?? 2} responsibilities</strong> per confirmed camper.
            </p>
          </div>
          <div style={{ textAlign: "right" }}>
            <span
              className="badge"
              style={{
                fontSize: "0.9rem",
                padding: "0.35rem 0.75rem",
                background: quotaProgress?.target_reached ? "#16a34a" : "#e2e8f0",
                color: quotaProgress?.target_reached ? "#ffffff" : "#334155",
                fontWeight: 600,
                borderRadius: "9999px",
              }}
            >
              {quotaProgress?.target_reached
                ? `${quotaProgress.claimed_count} of ${quotaProgress.quota_target} responsibilities selected (Target reached)`
                : `${quotaProgress?.claimed_count ?? 0} of ${quotaProgress?.quota_target ?? 2} responsibilities selected`}
            </span>
          </div>
        </div>

        {/* Progress Breakdown */}
        <div style={{ display: "flex", gap: "1.5rem", marginTop: "1rem", flexWrap: "wrap", fontSize: "0.9rem" }}>
          <div>
            <span style={{ color: "#64748b" }}>Duties Claimed: </span>
            <strong>{quotaProgress?.claimed_count ?? 0}</strong>
            <span style={{ color: "#64748b", marginLeft: "0.25rem" }}>({quotaProgress?.claimed_weight ?? 0}x workload)</span>
          </div>
          {(quotaProgress?.driver_credit ?? 0) > 0 && (
            <div>
              <span style={{ color: "#64748b" }}>Driver Workload Credit: </span>
              <strong style={{ color: "#0284c7" }}>+{quotaProgress?.driver_credit}x</strong>
            </div>
          )}
          <div>
            <span style={{ color: "#64748b" }}>Total Workload Score: </span>
            <strong>{quotaProgress?.total_score ?? 0}x</strong>
          </div>
        </div>
      </div>}

      {/* Driver Workload Credits Section */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem", flexWrap: "wrap", gap: "0.5rem" }}>
          <div>
            <h3 style={{ margin: 0, fontSize: "1.1rem" }}>🚗 Approved Driver Credits</h3>
            <p style={{ margin: "0.2rem 0 0 0", fontSize: "0.85rem", color: "#64748b" }}>
              Volunteer carpool drivers receive workload credits toward their trip responsibility quota.
            </p>
          </div>
          {isAdmin && (
            <button
              type="button"
              className="secondary-button"
              style={{ fontSize: "0.85rem", padding: "0.25rem 0.65rem" }}
              onClick={() => setShowDriverModal(true)}
            >
              + Grant Driver Credit
            </button>
          )}
        </div>

        {driverCredits.length === 0 ? (
          <p style={{ color: "#94a3b8", fontSize: "0.9rem", fontStyle: "italic", margin: "0.5rem 0 0 0" }}>
            No driver workload credits assigned yet.
          </p>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginTop: "0.5rem" }}>
            {driverCredits.map((c) => {
              const memberName = attendees.find((a) => a.memberId === c.member_id)?.displayName ?? "Driver";
              return (
                <div
                  key={c.id}
                  style={{
                    background: "#f0f9ff",
                    border: "1px solid #bae6fd",
                    borderRadius: "8px",
                    padding: "0.4rem 0.8rem",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    fontSize: "0.875rem",
                  }}
                >
                  <span style={{ fontWeight: 600, color: "#0369a1" }}>{memberName}</span>
                  <span className="badge" style={{ background: "#e0f2fe", color: "#0369a1", fontSize: "0.8rem" }}>
                    +{c.workload_credit}x Credit
                  </span>
                  {c.notes && <span style={{ color: "#64748b", fontSize: "0.8rem" }}>({c.notes})</span>}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Chronological Schedule Matrix */}
      {sortedDates.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "2.5rem 1rem", color: "#64748b" }}>
          <p style={{ margin: 0, fontSize: "1.1rem", fontWeight: 500 }}>No meal or chore slots scheduled yet.</p>
          <p style={{ margin: "0.5rem 0 0 0", fontSize: "0.9rem" }}>
            Administrators choose responsibilities for each event date using the "Manage Meals &amp; Chores" button above.
          </p>
        </div>
      ) : (
        sortedDates.map((dateStr) => {
          const slotsForDate = groupedByDate[dateStr] ?? [];
          const formattedDate = new Date(`${dateStr}T12:00:00Z`).toLocaleDateString("en-US", {
            weekday: "long",
            month: "short",
            day: "numeric",
          });

          // Flatten active duties for this date, keeping slot metadata
          const dutiesForDate = slotsForDate.flatMap((slot) =>
            (slot.duties ?? []).filter((d) => d.is_active).map((duty) => ({
              ...duty,
              slotLabel: slot.label,
              slotType: slot.slot_type,
              timeBlock: slot.time_block,
            }))
          );

          // Check if current volunteer has met their required chore(s) for this day
          const dayDate = new Date(`${dateStr}T12:00:00Z`);
          const dayName = !isNaN(dayDate.getTime())
            ? dayDate.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })
            : "this day";
          const dayWorkload = dailyWorkload?.days?.find((d) => d.date === dateStr);
          const myAssignmentsOnThisDay = dutiesForDate.filter((d) =>
            assignments.some((a) => a.slot_duty_id === d.id && a.member_id === currentMemberId)
          );
          const dayWeightSelected = dayWorkload != null
            ? dayWorkload.selectedWeight
            : myAssignmentsOnThisDay.reduce((sum, d) => sum + (d.workload_weight ?? 1), 0);
          const dayTarget = dailyWorkload?.target ?? 2;
          const isNoTasksAvailable = dayWorkload?.status === "no_tasks_available";
          const isNoTasksScheduled = dayWorkload?.status === "no_tasks_scheduled";
          const isDoneForThisDay = isConfirmedAttendee && (
            (dailyWorkload?.target != null
              ? (dayWeightSelected >= dayTarget || dayWorkload?.status === "target_met" || isNoTasksAvailable || isNoTasksScheduled)
              : myAssignmentsOnThisDay.length >= 1)
          );

          return (
            <div key={dateStr} className="date-matrix-group stack" style={{ gap: "0.75rem" }}>
              <div
                style={{
                  background: isDoneForThisDay ? "#f0fdf4" : "#f8fafc",
                  border: `1px solid ${isDoneForThisDay ? "#bbf7d0" : "#cbd5e1"}`,
                  borderRadius: "10px",
                  padding: "0.75rem 1rem",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "0.5rem",
                }}
              >
                <div>
                  <h3 style={{ margin: 0, fontSize: "1.1rem", color: "#1e293b" }}>
                    📅 {formattedDate}
                  </h3>
                  <p
                    style={{
                      margin: "0.25rem 0 0 0",
                      fontSize: "0.875rem",
                      color: isDoneForThisDay ? "#166534" : "#475569",
                      fontWeight: isDoneForThisDay ? 600 : 500,
                    }}
                  >
                    {dailyWorkload?.target != null ? (
                      <>
                        <span>{`${dayWeightSelected}× / ${dayTarget}×`}</span>
                        {" · "}
                        {isDoneForThisDay ? (
                          isNoTasksAvailable ? (
                            "No tasks available. No additional selection required."
                          ) : isNoTasksScheduled ? (
                            "No active tasks scheduled. No selection required."
                          ) : (
                            `✓ Target Met for ${dayName}!`
                          )
                        ) : (
                          `Select chores worth ${dayTarget}× for ${dayName} (Select at least ${(dayTarget - dayWeightSelected).toFixed(1).replace(/\.0$/, "")}× more while slots remain).`
                        )}
                      </>
                    ) : (
                      isDoneForThisDay ? (
                        `✓ Target Met for ${dayName}!`
                      ) : (
                        `Select chores worth 2× for ${dayName}`
                      )
                    )}
                  </p>
                </div>
                <div>
                  {isDoneForThisDay && (
                    <span
                      className="badge"
                      style={{
                        fontSize: "0.8rem",
                        background: "#dcfce7",
                        color: "#15803d",
                        border: "1px solid #86efac",
                        fontWeight: 600,
                        padding: "0.3rem 0.65rem",
                        borderRadius: "9999px",
                      }}
                    >
                      ✓ Daily chores selected
                    </span>
                  )}
                  {dailyWorkload?.target != null && !isDoneForThisDay && (
                    <span
                      className="badge"
                      style={{
                        fontSize: "0.8rem",
                        background: "#e0e7ff",
                        color: "#3730a3",
                        border: "1px solid #c7d2fe",
                        fontWeight: 600,
                        padding: "0.3rem 0.65rem",
                        borderRadius: "9999px",
                      }}
                    >
                      {`${dayWeightSelected}× / ${dayTarget}× selected`}
                    </span>
                  )}
                </div>
              </div>

              {dutiesForDate.length === 0 ? (
                <div className="card" style={{ padding: "1.25rem", color: "#64748b", fontStyle: "italic" }}>
                  <p style={{ margin: 0 }}>No meal or chore slots scheduled for this day.</p>
                </div>
              ) : (
                <div className="duties-list" style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                  {dutiesForDate.map((duty) => {
                    const dutyAssignments = assignments.filter((a) => a.slot_duty_id === duty.id);
                    const spotsTaken = dutyAssignments.length;
                    const spotsAvailable = Math.max(0, duty.capacity - spotsTaken);
                    const isFull = spotsAvailable === 0;

                    const myAssignment = dutyAssignments.find((a) => a.member_id === currentMemberId);
                    const iHaveClaimed = Boolean(myAssignment);
                    const isGreyedOut = isDoneForThisDay && !iHaveClaimed;

                    return (
                      <div
                        key={duty.id}
                        className="duty-item-row"
                        style={{
                          background: iHaveClaimed ? "#f0fdf4" : isGreyedOut ? "#f8fafc" : "#ffffff",
                          border: `1px solid ${iHaveClaimed ? "#86efac" : "#e2e8f0"}`,
                          borderRadius: "8px",
                          padding: "0.75rem 1rem",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          flexWrap: "wrap",
                          gap: "0.75rem",
                          opacity: isGreyedOut ? 0.6 : 1,
                        }}
                      >
                        <div style={{ flex: "1 1 250px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                            <strong style={{ fontSize: "0.95rem", color: "#1e293b" }}>
                              {duty.responsibility?.title ?? "Responsibility"}
                            </strong>
                            <span style={{ fontSize: "0.8rem", color: "#64748b" }}>
                              ({duty.workload_weight}x weight)
                            </span>
                            {duty.slotLabel && (
                              <span
                                className="badge"
                                style={{
                                  fontSize: "0.75rem",
                                  background: duty.slotType === "meal" ? "#fef3c7" : "#e0e7ff",
                                  color: duty.slotType === "meal" ? "#92400e" : "#3730a3",
                                }}
                              >
                                {duty.slotLabel}
                              </span>
                            )}
                          </div>
                          {duty.responsibility?.description && (
                            <p style={{ margin: "0.2rem 0 0 0", fontSize: "0.825rem", color: "#475569" }}>
                              {duty.responsibility.description}
                            </p>
                          )}

                          {/* Volunteers List */}
                          <div style={{ marginTop: "0.5rem", display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.4rem" }}>
                            <span style={{ fontSize: "0.8rem", color: "#64748b", fontWeight: 500 }}>Volunteers:</span>
                            {dutyAssignments.length === 0 ? (
                              <span style={{ fontSize: "0.8rem", color: "#94a3b8", fontStyle: "italic" }}>
                                None yet ({spotsAvailable} spots open)
                              </span>
                            ) : (
                              dutyAssignments.map((a) => (
                                <span
                                  key={a.id}
                                  style={{
                                    fontSize: "0.8rem",
                                    padding: "0.2rem 0.55rem",
                                    background: a.member_id === currentMemberId ? "#dbeafe" : "#f1f5f9",
                                    color: a.member_id === currentMemberId ? "#1d4ed8" : "#334155",
                                    borderRadius: "6px",
                                    fontWeight: a.member_id === currentMemberId ? 600 : 400,
                                    border: a.member_id === currentMemberId ? "1px solid #93c5fd" : "1px solid #e2e8f0",
                                  }}
                                >
                                  {a.member?.display_name ?? "Member"}
                                  {a.member_id === currentMemberId && " (You)"}
                                </span>
                              ))
                            )}
                          </div>
                        </div>

                        {/* Capacity Counter & Action Buttons */}
                        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
                          <div style={{ textAlign: "right" }}>
                            <span
                              style={{
                                fontSize: "0.85rem",
                                fontWeight: 600,
                                color: isFull ? "#dc2626" : "#16a34a",
                                display: "block",
                              }}
                            >
                              {spotsTaken} / {duty.capacity} filled
                            </span>
                            <span style={{ fontSize: "0.75rem", color: "#64748b" }}>
                              {isFull ? "Full" : `${spotsAvailable} open`}
                            </span>
                          </div>

                          {iHaveClaimed && myAssignment ? (
                            <button
                              type="button"
                              className="secondary-button"
                              disabled={isPending}
                              onClick={() => handleDropDuty(myAssignment.id)}
                              style={{
                                fontSize: "0.85rem",
                                padding: "0.35rem 0.75rem",
                                color: "#b91c1c",
                                borderColor: "#fca5a5",
                              }}
                            >
                              Drop Task
                            </button>
                          ) : isGreyedOut ? (
                            <button
                              type="button"
                              className="secondary-button"
                              disabled
                              style={{
                                fontSize: "0.85rem",
                                padding: "0.35rem 0.75rem",
                                opacity: 0.55,
                                cursor: "not-allowed",
                                background: "#f1f5f9",
                                color: "#64748b",
                                borderColor: "#cbd5e1",
                              }}
                              title="You have selected your required chores for this day. Drop your claimed chore to select another."
                            >
                              Done for Day
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="primary-button"
                              disabled={isPending || isFull || !isConfirmedAttendee}
                              onClick={() => handleClaimDuty(duty.id, false)}
                              style={{ fontSize: "0.85rem", padding: "0.35rem 0.75rem" }}
                              title={
                                !isConfirmedAttendee
                                  ? "Only confirmed Going attendees can volunteer"
                                  : isFull
                                  ? "This responsibility is full"
                                  : "Volunteer for this responsibility"
                              }
                            >
                              {isFull ? "Full" : "Volunteer"}
                            </button>
                          )}

                          {isAdmin && (
                            <button
                              type="button"
                              className="secondary-button"
                              disabled={isPending || isFull}
                              onClick={() => {
                                setAssigningDuty(duty);
                                setSelectedMemberToAssign("");
                              }}
                              style={{ fontSize: "0.8rem", padding: "0.35rem 0.6rem" }}
                              title="Assign a confirmed camper to this duty"
                            >
                              Assign…
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })
      )}

      {/* Cook & Kitchen Headcounts */}
      <div className="card" data-testid="cook-headcounts-card">
        <h3 style={{ margin: 0, fontSize: "1.15rem", color: "#0f172a" }}>👨‍🍳 Cook &amp; Kitchen Headcounts</h3>
        <p style={{ margin: "0.25rem 0 1rem 0", color: "#64748b", fontSize: "0.85rem" }}>
          Live counts of confirmed campers eating and drinking for each meal.
        </p>

        {/* Morning Hot Beverages */}
        <div style={{ marginBottom: "1.25rem", background: "#f8fafc", padding: "1rem", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
          <h4 style={{ margin: "0 0 0.5rem 0", fontSize: "0.95rem", color: "#0f172a" }}>☕ Morning Hot Beverages</h4>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem" }}>
            <div style={{ background: "#ffffff", padding: "0.75rem", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
              <strong style={{ fontSize: "0.875rem", color: "#0369a1", display: "block", marginBottom: "0.4rem" }}>
                Saturday Morning:
              </strong>
              <div style={{ fontSize: "0.875rem", display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                <span>☕ Coffee: <strong>{mealHeadcounts?.beverages?.saturday?.coffee ?? 0}</strong></span>
                <span>🍵 Tea: <strong>{mealHeadcounts?.beverages?.saturday?.tea ?? 0}</strong></span>
                <span>🚫 None: <strong>{mealHeadcounts?.beverages?.saturday?.none ?? 0}</strong></span>
              </div>
            </div>
            <div style={{ background: "#ffffff", padding: "0.75rem", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
              <strong style={{ fontSize: "0.875rem", color: "#0369a1", display: "block", marginBottom: "0.4rem" }}>
                Sunday Morning:
              </strong>
              <div style={{ fontSize: "0.875rem", display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                <span>☕ Coffee: <strong>{mealHeadcounts?.beverages?.sunday?.coffee ?? 0}</strong></span>
                <span>🍵 Tea: <strong>{mealHeadcounts?.beverages?.sunday?.tea ?? 0}</strong></span>
                <span>🚫 None: <strong>{mealHeadcounts?.beverages?.sunday?.none ?? 0}</strong></span>
              </div>
            </div>
          </div>
        </div>

        {/* Meal Portions Table */}
        <h4 style={{ margin: "0 0 0.5rem 0", fontSize: "0.95rem", color: "#0f172a" }}>🍲 Meal Portions &amp; Opt-Outs</h4>
        {(!mealHeadcounts?.meals || mealHeadcounts.meals.length === 0) ? (
          <p style={{ color: "#94a3b8", fontSize: "0.875rem", fontStyle: "italic", margin: 0 }}>
            No meal slots scheduled yet.
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table data-testid="cook-meals-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
              <thead>
                <tr style={{ background: "#f1f5f9", textAlign: "left", borderBottom: "2px solid #cbd5e1" }}>
                  <th style={{ padding: "0.5rem 0.75rem" }}>Meal</th>
                  <th style={{ padding: "0.5rem 0.75rem" }}>Date</th>
                  <th style={{ padding: "0.5rem 0.75rem" }}>🥗 Veg</th>
                  <th style={{ padding: "0.5rem 0.75rem" }}>🍖 Non-Veg</th>
                  <th style={{ padding: "0.5rem 0.75rem" }}>🚫 Skip</th>
                  <th style={{ padding: "0.5rem 0.75rem" }}>Total Eating</th>
                </tr>
              </thead>
              <tbody>
                {mealHeadcounts.meals.map((m) => (
                  <tr key={m.slotId} style={{ borderBottom: "1px solid #e2e8f0" }}>
                    <td style={{ padding: "0.5rem 0.75rem", fontWeight: 600 }}>{m.slotLabel}</td>
                    <td style={{ padding: "0.5rem 0.75rem", color: "#64748b" }}>{m.slotDate}</td>
                    <td style={{ padding: "0.5rem 0.75rem", color: "#16a34a", fontWeight: 600 }}>{m.vegCount}</td>
                    <td style={{ padding: "0.5rem 0.75rem", color: "#b45309", fontWeight: 600 }}>{m.nonVegCount}</td>
                    <td style={{ padding: "0.5rem 0.75rem", color: "#64748b" }}>{m.skipCount}</td>
                    <td style={{ padding: "0.5rem 0.75rem", fontWeight: 700, color: "#0f172a" }}>{m.totalEating}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Overlap Confirmation Modal */}
      {overlapDuty && (
        <div className="modal-overlay" onClick={() => setOverlapDuty(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "480px" }}>
            <h3 style={{ margin: "0 0 0.5rem 0", color: "#92400e" }}>⚠️ Schedule Overlap Warning</h3>
            <p style={{ margin: "0 0 1rem 0", fontSize: "0.95rem", color: "#334155" }}>
              {overlapDuty.message}
            </p>
            <p style={{ margin: "0 0 1.25rem 0", fontSize: "0.875rem", color: "#64748b" }}>
              You may still proceed if you are able to handle both duties during this time block.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem" }}>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setOverlapDuty(null)}
                disabled={isPending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => handleClaimDuty(overlapDuty.dutyId, true)}
                disabled={isPending}
              >
                Proceed &amp; Volunteer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Admin Assign Modal */}
      {assigningDuty && (
        <div className="modal-overlay" onClick={() => setAssigningDuty(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "480px" }}>
            <h3 style={{ margin: "0 0 0.5rem 0" }}>
              Assign Volunteer: {assigningDuty.responsibility?.title ?? "Duty"}
            </h3>
            <p style={{ margin: "0 0 1rem 0", fontSize: "0.875rem", color: "#64748b" }}>
              Select a confirmed camper to assign to this responsibility.
            </p>
            <form onSubmit={handleAdminAssign}>
              <label style={{ display: "block", marginBottom: "1rem" }}>
                Camper:
                <select
                  required
                  value={selectedMemberToAssign}
                  onChange={(e) => setSelectedMemberToAssign(e.target.value)}
                  style={{ width: "100%", padding: "0.5rem", marginTop: "0.35rem" }}
                >
                  <option value="">-- Choose confirmed attendee --</option>
                  {attendees.map((a) => (
                    <option key={a.memberId} value={a.memberId}>
                      {a.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem" }}>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setAssigningDuty(null)}
                  disabled={isPending}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="primary-button"
                  disabled={isPending || !selectedMemberToAssign}
                >
                  {isPending ? "Assigning…" : "Assign Camper"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Admin Grant Driver Credit Modal */}
      {showDriverModal && (
        <div className="modal-overlay" onClick={() => setShowDriverModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "480px" }}>
            <h3 style={{ margin: "0 0 0.5rem 0" }}>Grant Driver Workload Credit</h3>
            <p style={{ margin: "0 0 1rem 0", fontSize: "0.875rem", color: "#64748b" }}>
              Credit approved carpool drivers with workload points toward their trip responsibility quota.
            </p>
            <form onSubmit={handleSaveDriverCredit}>
              <label style={{ display: "block", marginBottom: "0.75rem" }}>
                Driver (Attendee):
                <select
                  required
                  value={driverMemberId}
                  onChange={(e) => setDriverMemberId(e.target.value)}
                  style={{ width: "100%", padding: "0.5rem", marginTop: "0.35rem" }}
                >
                  <option value="">-- Select driver --</option>
                  {attendees.map((a) => (
                    <option key={a.memberId} value={a.memberId}>
                      {a.displayName}
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ display: "block", marginBottom: "0.75rem" }}>
                Workload Credit (Points):
                <select
                  value={driverCreditAmount}
                  onChange={(e) => setDriverCreditAmount(Number(e.target.value))}
                  style={{ width: "100%", padding: "0.5rem", marginTop: "0.35rem" }}
                >
                  <option value="1.0">1.0 point (Standard Carpool Driver)</option>
                  <option value="1.5">1.5 points (Long Distance Carpool)</option>
                  <option value="2.0">2.0 points (trip-wide credit)</option>
                </select>
              </label>

              <label style={{ display: "block", marginBottom: "1rem" }}>
                Notes / Carpool Route (Optional):
                <input
                  type="text"
                  placeholder="e.g. Seattle to Lake Chelan 4 passengers"
                  value={driverNotes}
                  onChange={(e) => setDriverNotes(e.target.value)}
                  style={{ width: "100%", padding: "0.5rem", marginTop: "0.35rem" }}
                />
              </label>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem" }}>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setShowDriverModal(false)}
                  disabled={isPending}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="primary-button"
                  disabled={isPending || !driverMemberId}
                >
                  {isPending ? "Saving…" : "Grant Credit"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
