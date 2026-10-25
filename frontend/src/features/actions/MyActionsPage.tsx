import { useEffect, useState } from "react";
import { Link } from "react-router";
import { invokeTripApi } from "../../lib/supabase";
import {
  type ActionItem,
  resolveActionsForCalendarTrip,
  sortActionsByPriority,
} from "../../domain/actionResolution";
import type { Calendar, Trip, TripApi } from "../trips/TripCalendarPage";

type Props = {
  api?: TripApi;
};

export function MyActionsPage({ api = invokeTripApi }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [calendar, setCalendar] = useState<Calendar | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const data = await api<Calendar>("get_calendar");
        if (active) {
          setCalendar(data);
        }
      } catch (err: unknown) {
        if (active) {
          setError((err as Error)?.message || "Could not load actions.");
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
  }, [api]);

  if (loading) {
    return (
      <div className="container" style={{ padding: "2rem 1rem", textAlign: "center" }}>
        <p role="status" style={{ color: "#64748b" }}>Loading your personal task inbox…</p>
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

  // Resolve actions across all trips
  const trips: Trip[] = calendar?.trips ?? [];
  const allActions: ActionItem[] = trips.flatMap((trip) => resolveActionsForCalendarTrip(trip));
  const sortedActions = sortActionsByPriority(allActions);

  const actionRequired = sortedActions.filter(
    (a) => a.priority === "critical" || a.priority === "high" || a.informationLevel === "action_required"
  );
  const reviewRecommended = sortedActions.filter(
    (a) =>
      a.priority === "normal" &&
      a.informationLevel !== "action_required" &&
      !actionRequired.some((req) => req.id === a.id)
  );
  const informational = sortedActions.filter(
    (a) =>
      a.priority === "info" ||
      (a.informationLevel === "informational" &&
        !actionRequired.some((req) => req.id === a.id) &&
        !reviewRecommended.some((rev) => rev.id === a.id))
  );

  const totalCount = sortedActions.length;

  return (
    <div className="container" style={{ maxWidth: "800px", margin: "0 auto", padding: "1rem" }}>
      {/* Header */}
      <div style={{ marginBottom: "1.5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "0.5rem" }}>
          <div>
            <h1 style={{ margin: "0 0 0.25rem", fontSize: "1.5rem", color: "#1e293b" }}>
              ⚡ My Personal Actions
            </h1>
            <p style={{ margin: 0, color: "#64748b", fontSize: "0.9rem" }}>
              Consolidated task inbox across all your active camping trips.
            </p>
          </div>
          {totalCount > 0 && (
            <span
              style={{
                background: actionRequired.length > 0 ? "#fee2e2" : "#fef3c7",
                color: actionRequired.length > 0 ? "#991b1b" : "#92400e",
                padding: "0.25rem 0.75rem",
                borderRadius: "9999px",
                fontSize: "0.8rem",
                fontWeight: 700,
              }}
            >
              {actionRequired.length > 0 ? `🚨 ${actionRequired.length} Urgent` : `${totalCount} Pending`}
            </span>
          )}
        </div>
      </div>

      {/* Empty State */}
      {totalCount === 0 ? (
        <div
          data-testid="actions-empty-state"
          style={{
            background: "#f0fdf4",
            border: "1px solid #bbf7d0",
            borderRadius: "12px",
            padding: "2.5rem 1.5rem",
            textAlign: "center",
            marginTop: "1.5rem",
          }}
        >
          <div style={{ fontSize: "2.5rem", marginBottom: "0.5rem" }}>🎉</div>
          <h2 style={{ margin: "0 0 0.5rem", color: "#166534", fontSize: "1.25rem" }}>
            You're All Caught Up!
          </h2>
          <p style={{ margin: "0 0 1.25rem", color: "#15803d", fontSize: "0.9rem" }}>
            No outstanding actions or tasks across your upcoming camping trips. Sit back and get ready for the campfire!
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
            Explore Camping Trips →
          </Link>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          {/* Section 1: Action Required */}
          {actionRequired.length > 0 && (
            <section aria-labelledby="section-action-required">
              <h2
                id="section-action-required"
                style={{
                  fontSize: "1rem",
                  color: "#991b1b",
                  margin: "0 0 0.75rem",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.4rem",
                }}
              >
                <span>🚨</span> Action Required ({actionRequired.length})
              </h2>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                {actionRequired.map((action) => (
                  <ActionCard key={action.id} action={action} />
                ))}
              </div>
            </section>
          )}

          {/* Section 2: Review Recommended */}
          {reviewRecommended.length > 0 && (
            <section aria-labelledby="section-review-recommended">
              <h2
                id="section-review-recommended"
                style={{
                  fontSize: "1rem",
                  color: "#92400e",
                  margin: "0 0 0.75rem",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.4rem",
                }}
              >
                <span>⚡</span> Review Recommended ({reviewRecommended.length})
              </h2>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                {reviewRecommended.map((action) => (
                  <ActionCard key={action.id} action={action} />
                ))}
              </div>
            </section>
          )}

          {/* Section 3: Informational */}
          {informational.length > 0 && (
            <section aria-labelledby="section-informational">
              <h2
                id="section-informational"
                style={{
                  fontSize: "1rem",
                  color: "#1e40af",
                  margin: "0 0 0.75rem",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.4rem",
                }}
              >
                <span>ℹ️</span> Informational ({informational.length})
              </h2>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                {informational.map((action) => (
                  <ActionCard key={action.id} action={action} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function ActionCard({ action }: { action: ActionItem }) {
  const isCritical = action.priority === "critical";
  const isHigh = action.priority === "high";

  return (
    <article
      data-testid={`action-card-${action.id}`}
      style={{
        background: "#ffffff",
        border: `1px solid ${isCritical ? "#fecaca" : isHigh ? "#fde68a" : "#e2e8f0"}`,
        borderLeft: `4px solid ${isCritical ? "#dc2626" : isHigh ? "#f59e0b" : "#3b82f6"}`,
        borderRadius: "8px",
        padding: "1rem",
        boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "0.5rem" }}>
        <div style={{ flex: 1, minWidth: "240px" }}>
          {action.tripTitle && (
            <span
              style={{
                fontSize: "0.75rem",
                color: "#64748b",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.03em",
                display: "block",
                marginBottom: "0.2rem",
              }}
            >
              🏕️ {action.tripTitle}
            </span>
          )}
          <h3 style={{ margin: "0 0 0.35rem", fontSize: "1rem", color: "#1e293b" }}>
            {action.title}
          </h3>
          <p style={{ margin: "0 0 0.25rem", color: "#475569", fontSize: "0.85rem" }}>
            {action.reason}
          </p>
          {action.explanationDetails && (
            <p style={{ margin: "0 0 0.25rem", color: isCritical ? "#991b1b" : isHigh ? "#92400e" : "#0f766e", fontSize: "0.82rem", fontWeight: 500 }}>
              {action.explanationDetails}
            </p>
          )}
          {action.dueAt && (
            <span style={{ fontSize: "0.76rem", color: "#64748b" }}>
              ⏱️ Deadline: {new Date(action.dueAt).toLocaleDateString()}
            </span>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", width: "100%", justifyContent: "flex-end", marginTop: "0.5rem" }}>
          <Link
            to={action.actionUrl}
            style={{
              padding: "0.5rem 1.25rem",
              background: isCritical ? "#dc2626" : isHigh ? "#b45309" : "#0284c7",
              color: "#ffffff",
              borderRadius: "6px",
              fontWeight: 600,
              fontSize: "0.84rem",
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: "44px",
              width: "100%",
            }}
          >
            Resolve Action →
          </Link>
        </div>
      </div>
    </article>
  );
}
