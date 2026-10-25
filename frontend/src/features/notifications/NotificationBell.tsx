import { useEffect, useState } from "react";
import { invokeTripApi, invokeMemberApi } from "../../lib/supabase";
import {
  type ActionItem,
  resolveActionsForCalendarTrip,
  resolveAdminActions,
} from "../../domain/actionResolution";
import { NotificationDrawer, type NotificationItem } from "./NotificationDrawer";
import type { Calendar, Trip } from "../trips/TripCalendarPage";

interface NotificationBellProps {
  memberId?: string | null;
  role?: string | null;
}

export function NotificationBell({ memberId, role }: NotificationBellProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const storageKey = `camping_club_dismissed_notifications_${memberId || "guest"}`;

  useEffect(() => {
    let active = true;

    async function loadNotifications() {
      try {
        const cal = await invokeTripApi<Calendar>("get_calendar");
        const trips: Trip[] = cal?.trips ?? [];

        // Member actions
        const memberActions: ActionItem[] = trips.flatMap((trip) =>
          resolveActionsForCalendarTrip(trip)
        );

        // Admin actions if user is an admin
        let adminActions: ActionItem[] = [];
        if (role === "admin") {
          let pendingRequests: Array<{ memberId: string; fullName: string; email: string }> = [];
          try {
            const reqData = await invokeMemberApi<{ requests: Array<any> }>("list_access_requests");
            pendingRequests = (reqData.requests ?? []).map((r) => ({
              memberId: r.member_id || r.id,
              fullName: r.full_name || r.name || "Unknown",
              email: r.email,
            }));
          } catch {
            // Non-blocking
          }

          adminActions = resolveAdminActions({
            pendingAccessRequests: pendingRequests,
            trips: trips.map((t) => ({
              tripId: t.tripId,
              title: t.title || "Camping Trip",
              eventStatus: t.eventStatus === "cancelled" ? "cancelled" : t.eventStatus === "confirmed" ? "confirmed" : "tentative",
              pollDeadlineAt: t.pollDeadlineAt,
              startsOn: t.startsOn,
              endsOn: t.endsOn,
              confirmedCount: t.comingCount ?? 0,
              minimumParticipants: t.minimumParticipants ?? 4,
              submittedDeposits: [],
              unverifiedWaivers: [],
              waitlistedMembers: [],
            })),
          });
        }

        const combinedActions = [...memberActions, ...adminActions];

        // Deduplicate by ID
        const seen = new Set<string>();
        const uniqueItems: NotificationItem[] = [];

        for (const act of combinedActions) {
          if (!seen.has(act.id)) {
            seen.add(act.id);
            uniqueItems.push({
              id: act.id,
              title: act.title,
              reason: act.reason,
              explanationDetails: act.explanationDetails,
              category: act.informationLevel,
              priority: act.priority,
              actionUrl: act.actionUrl,
              tripId: act.tripId,
              tripTitle: act.tripTitle,
              dueAt: act.dueAt,
            });
          }
        }

        if (active) {
          setNotifications(uniqueItems);
        }
      } catch {
        // Fallback gracefully on network error
      }
    }

    void loadNotifications();
    return () => {
      active = false;
    };
  }, [memberId, role]);

  // Read dismissed IDs from localStorage
  const getActiveCount = () => {
    try {
      const raw = localStorage.getItem(storageKey);
      const dismissed: string[] = raw ? JSON.parse(raw) : [];
      return notifications.filter((n) => !dismissed.includes(n.id)).length;
    } catch {
      return notifications.length;
    }
  };

  const activeCount = getActiveCount();

  return (
    <>
      <button
        type="button"
        className="notification-bell-btn"
        aria-label="Notifications"
        onClick={() => {
          setIsOpen(!isOpen);
        }}
        style={{
          position: "relative",
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: "0.4rem",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "6px",
          color: "#475569",
        }}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>

        {activeCount > 0 && (
          <span
            data-testid="notification-unread-badge"
            style={{
              position: "absolute",
              top: "-2px",
              right: "-2px",
              background: "#ef4444",
              color: "#ffffff",
              fontSize: "0.65rem",
              fontWeight: 700,
              borderRadius: "9999px",
              minWidth: "16px",
              height: "16px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0 3px",
              border: "2px solid #ffffff",
            }}
          >
            {activeCount > 9 ? "9+" : activeCount}
          </span>
        )}
      </button>

      <NotificationDrawer
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        notifications={notifications}
        memberId={memberId}
      />
    </>
  );
}
