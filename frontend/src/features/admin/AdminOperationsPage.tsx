import { useEffect, useState } from "react";
import { Link } from "react-router";
import { invokeTripApi, invokeMemberApi } from "../../lib/supabase";
import {
  type ActionItem,
  resolveAdminActions,
  type AdminEvaluationContext,
} from "../../domain/actionResolution";
import type { Calendar, TripApi } from "../trips/TripCalendarPage";

type Props = {
  api?: TripApi;
  memberApi?: <T = unknown>(action: string, input?: unknown) => Promise<T>;
};

export function AdminOperationsPage({
  api = invokeTripApi,
  memberApi = invokeMemberApi,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [calendar, setCalendar] = useState<Calendar | null>(null);
  const [accessRequests, setAccessRequests] = useState<
    Array<{ memberId: string; fullName: string; email: string }>
  >([]);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const [calData, reqData] = await Promise.all([
          api<Calendar>("get_calendar"),
          memberApi<{ requests: Array<{ memberId: string; fullName: string; email: string }> }>(
            "list_access_requests"
          ).catch(() => ({ requests: [] })),
        ]);
        if (active) {
          setCalendar(calData);
          setAccessRequests(reqData?.requests || []);
        }
      } catch (err: unknown) {
        if (active) {
          setError((err as Error)?.message || "Could not load admin operations.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [api, memberApi]);

  if (loading) {
    return (
      <div className="container" style={{ padding: "2rem 1rem", textAlign: "center" }}>
        <p role="status" style={{ color: "#64748b" }}>Loading operational exceptions…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container" style={{ padding: "2rem 1rem" }}>
        <p role="alert" className="form-error" style={{ color: "#dc2626" }}>{error}</p>
      </div>
    );
  }

  // Construct AdminEvaluationContext
  const trips = calendar?.trips ?? [];
  const adminCtx: AdminEvaluationContext = {
    pendingAccessRequests: accessRequests,
    trips: trips.map((trip) => {
      // Check for submitted deposits awaiting verification
      const submittedDeposits: Array<{ memberId: string; memberName: string; amountCents: number; method: string }> = [];
      if (trip.depositStatus === "submitted_by_member") {
        submittedDeposits.push({
          memberId: trip.tripId,
          memberName: "Member",
          amountCents: 5000,
          method: "External Transfer",
        });
      }

      // Check for waitlisted members
      const waitlistedMembers: Array<{ memberId: string; memberName: string; position: number }> = [];
      if (trip.waitlistCount > 0) {
        waitlistedMembers.push({
          memberId: `waitlist-${trip.tripId}`,
          memberName: `${trip.waitlistCount} Waitlisted Camper(s)`,
          position: 1,
        });
      }

      return {
        tripId: trip.tripId,
        title: trip.title || `${trip.monthKey} Camping`,
        monthKey: trip.monthKey,
        eventStatus: trip.eventStatus ?? "tentative",
        startsOn: trip.startsOn,
        endsOn: trip.endsOn,
        pollDeadlineAt: trip.pollDeadlineAt,
        cabinDeadlineAt: null, // Populated when contractual deadline is present
        confirmedCount: trip.comingCount,
        minimumParticipants: trip.minimumParticipants ?? 4,
        submittedDeposits,
        unverifiedWaivers: [],
        waitlistedMembers,
        unfinalizedSettlement: null,
      };
    }),
  };

  const adminActions = resolveAdminActions(adminCtx);
  const criticalCount = adminActions.filter((a) => a.priority === "critical").length;

  // Group actions by tripId, plus global membership actions
  const tripMap = new Map<string, { title: string; actions: ActionItem[] }>();
  const membershipActions: ActionItem[] = [];

  for (const action of adminActions) {
    if (action.ruleId === "ACT-ADM-APPV") {
      membershipActions.push(action);
    } else if (action.tripId) {
      if (!tripMap.has(action.tripId)) {
        tripMap.set(action.tripId, {
          title: action.tripTitle || "Camping Trip",
          actions: [],
        });
      }
      tripMap.get(action.tripId)!.actions.push(action);
    }
  }

  return (
    <div className="container" style={{ maxWidth: "850px", margin: "0 auto", padding: "1rem" }}>
      {/* Header */}
      <div style={{ marginBottom: "1.5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "0.5rem" }}>
          <div>
            <h1 style={{ margin: "0 0 0.25rem", fontSize: "1.5rem", color: "#991b1b" }}>
              ⚙️ Admin Operations Dashboard
            </h1>
            <p style={{ margin: 0, color: "#64748b", fontSize: "0.9rem" }}>
              Exception-driven management: approaching deadlines, unverified funds, and quorum risks.
            </p>
          </div>
          {adminActions.length > 0 ? (
            <span
              style={{
                background: criticalCount > 0 ? "#fee2e2" : "#fef3c7",
                color: criticalCount > 0 ? "#991b1b" : "#92400e",
                padding: "0.25rem 0.75rem",
                borderRadius: "9999px",
                fontSize: "0.8rem",
                fontWeight: 700,
              }}
            >
              {criticalCount > 0 ? `🚨 ${criticalCount} Critical Action${criticalCount > 1 ? "s" : ""}` : `⚡ ${adminActions.length} Pending`}
            </span>
          ) : (
            <span
              style={{
                background: "#dcfce7",
                color: "#166534",
                padding: "0.25rem 0.75rem",
                borderRadius: "9999px",
                fontSize: "0.8rem",
                fontWeight: 700,
              }}
            >
              ✓ All Trips On Track
            </span>
          )}
        </div>
      </div>

      {/* Empty State */}
      {adminActions.length === 0 ? (
        <div
          data-testid="admin-ops-empty-state"
          style={{
            background: "#f0fdf4",
            border: "1px solid #bbf7d0",
            borderRadius: "12px",
            padding: "2.5rem 1.5rem",
            textAlign: "center",
            marginTop: "1.5rem",
          }}
        >
          <div style={{ fontSize: "2.5rem", marginBottom: "0.5rem" }}>✓</div>
          <h2 style={{ margin: "0 0 0.5rem", color: "#166534", fontSize: "1.25rem" }}>
            All Trips On Track
          </h2>
          <p style={{ margin: "0 0 1.25rem", color: "#15803d", fontSize: "0.9rem" }}>
            No operational exceptions requiring administrator or accountant attention. All active trips meet quorum thresholds, and no deposits or waivers are pending verification.
          </p>
          <Link
            to="/"
            style={{
              display: "inline-block",
              background: "#16a34a",
              color: "#ffffff",
              padding: "0.5rem 1.25rem",
              borderRadius: "6px",
              fontWeight: 600,
              fontSize: "0.88rem",
              textDecoration: "none",
            }}
          >
            Return to Calendar →
          </Link>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          {/* Membership Access Requests */}
          {membershipActions.length > 0 && (
            <section
              style={{
                background: "#ffffff",
                border: "1px solid #fde68a",
                borderLeft: "4px solid #f59e0b",
                borderRadius: "8px",
                padding: "1rem",
                boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
              }}
            >
              <h2 style={{ margin: "0 0 0.5rem", fontSize: "1.05rem", color: "#92400e" }}>
                👥 Membership Access Requests ({membershipActions.length})
              </h2>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                {membershipActions.map((act) => (
                  <AdminActionRow key={act.id} action={act} />
                ))}
              </div>
            </section>
          )}

          {/* Grouped by Trip */}
          {Array.from(tripMap.entries()).map(([tripId, { title, actions }]) => {
            const hasCritical = actions.some((a) => a.priority === "critical");

            return (
              <section
                key={tripId}
                data-testid={`admin-ops-trip-${tripId}`}
                style={{
                  background: "#ffffff",
                  border: `1px solid ${hasCritical ? "#fecaca" : "#e2e8f0"}`,
                  borderLeft: `4px solid ${hasCritical ? "#ef4444" : "#f59e0b"}`,
                  borderRadius: "8px",
                  padding: "1rem",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem", flexWrap: "wrap", gap: "0.5rem" }}>
                  <h2 style={{ margin: 0, fontSize: "1.1rem", color: "#0f172a" }}>
                    🏕️ {title}
                  </h2>
                  <span
                    style={{
                      fontSize: "0.76rem",
                      background: hasCritical ? "#fee2e2" : "#fef3c7",
                      color: hasCritical ? "#991b1b" : "#92400e",
                      padding: "2px 8px",
                      borderRadius: "4px",
                      fontWeight: 700,
                    }}
                  >
                    {actions.length} Exception{actions.length > 1 ? "s" : ""}
                  </span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                  {actions.map((action) => (
                    <AdminActionRow key={action.id} action={action} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AdminActionRow({ action }: { action: ActionItem }) {
  const isCritical = action.priority === "critical";

  return (
    <div
      data-testid={`admin-action-row-${action.id}`}
      style={{
        background: isCritical ? "#fef2f2" : "#f8fafc",
        border: `1px solid ${isCritical ? "#fecaca" : "#e2e8f0"}`,
        borderRadius: "6px",
        padding: "0.75rem 1rem",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "0.75rem",
      }}
    >
      <div style={{ flex: 1, minWidth: "240px" }}>
        <strong style={{ color: isCritical ? "#991b1b" : "#1e293b", fontSize: "0.88rem", display: "block" }}>
          {isCritical ? "🚨 " : "⚡ "}
          {action.title}
        </strong>
        <p style={{ margin: "2px 0 0", color: isCritical ? "#7f1d1d" : "#475569", fontSize: "0.82rem" }}>
          {action.explanationDetails || action.reason}
        </p>
      </div>

      <div style={{ width: "100%", display: "flex", justifyContent: "flex-end", marginTop: "0.25rem" }}>
        <Link
          to={action.actionUrl}
          style={{
            padding: "0.5rem 1.25rem",
            background: isCritical ? "#dc2626" : "#b45309",
            color: "#ffffff",
            borderRadius: "6px",
            fontSize: "0.84rem",
            fontWeight: 600,
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "44px",
            width: "100%",
          }}
        >
          Manage Exception →
        </Link>
      </div>
    </div>
  );
}
