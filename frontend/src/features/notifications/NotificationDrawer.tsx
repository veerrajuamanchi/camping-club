import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { InformationLevel } from "../../domain/actionResolution";

export interface NotificationItem {
  id: string;
  title: string;
  reason: string;
  explanationDetails?: string;
  category: InformationLevel;
  priority: "critical" | "high" | "normal" | "info";
  actionUrl: string;
  tripId?: string;
  tripTitle?: string;
  dueAt?: string;
  createdAt?: string;
}

interface NotificationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  notifications: NotificationItem[];
  memberId?: string | null;
}

export function NotificationDrawer({
  isOpen,
  onClose,
  notifications,
  memberId,
}: NotificationDrawerProps) {
  const storageKey = `camping_club_dismissed_notifications_${memberId || "guest"}`;
  const [activeTab, setActiveTab] = useState<InformationLevel>("action_required");
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch {
      return new Set();
    }
  });

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        setDismissedIds(new Set(JSON.parse(raw)));
      }
    } catch {
      // Ignore
    }
  }, [storageKey, isOpen]);

  if (!isOpen) return null;

  const activeNotifications = notifications.filter((n) => !dismissedIds.has(n.id));
  const filtered = activeNotifications.filter((n) => n.category === activeTab);

  const actionRequiredCount = activeNotifications.filter((n) => n.category === "action_required").length;
  const reviewRecommendedCount = activeNotifications.filter((n) => n.category === "review_recommended").length;
  const informationalCount = activeNotifications.filter((n) => n.category === "informational").length;

  const handleDismiss = (id: string) => {
    setDismissedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      try {
        localStorage.setItem(storageKey, JSON.stringify(Array.from(next)));
      } catch {
        // Ignore
      }
      return next;
    });
  };

  const handleMarkAllRead = () => {
    const allIds = notifications.map((n) => n.id);
    const next = new Set([...dismissedIds, ...allIds]);
    setDismissedIds(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(Array.from(next)));
    } catch {
      // Ignore
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="notification-drawer-title"
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width: "100%",
        maxWidth: "420px",
        background: "#ffffff",
        boxShadow: "-4px 0 24px rgba(0,0,0,0.15)",
        zIndex: 1000,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "1rem 1.25rem",
          borderBottom: "1px solid #e2e8f0",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          background: "#f8fafc",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ fontSize: "1.2rem" }}>🔔</span>
          <h2 id="notification-drawer-title" style={{ margin: 0, fontSize: "1.1rem" }}>
            Notifications
          </h2>
          {activeNotifications.length > 0 && (
            <span
              className="badge"
              style={{ background: "#dbeafe", color: "#1e40af", fontSize: "0.75rem" }}
            >
              {activeNotifications.length} active
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close notifications"
          style={{
            background: "none",
            border: "none",
            fontSize: "1.25rem",
            cursor: "pointer",
            padding: "0.25rem 0.5rem",
            color: "#64748b",
          }}
        >
          ✕
        </button>
      </div>

      {/* Tabs */}
      <div
        role="tablist"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          background: "#f1f5f9",
          padding: "0.25rem",
          gap: "0.25rem",
          borderBottom: "1px solid #e2e8f0",
        }}
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "action_required"}
          onClick={() => setActiveTab("action_required")}
          style={{
            padding: "0.45rem 0.25rem",
            fontSize: "0.78rem",
            fontWeight: 600,
            borderRadius: "6px",
            border: "none",
            background: activeTab === "action_required" ? "#ffffff" : "transparent",
            color: activeTab === "action_required" ? "#b91c1c" : "#64748b",
            boxShadow: activeTab === "action_required" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
            cursor: "pointer",
          }}
        >
          Action Required ({actionRequiredCount})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "review_recommended"}
          onClick={() => setActiveTab("review_recommended")}
          style={{
            padding: "0.45rem 0.25rem",
            fontSize: "0.78rem",
            fontWeight: 600,
            borderRadius: "6px",
            border: "none",
            background: activeTab === "review_recommended" ? "#ffffff" : "transparent",
            color: activeTab === "review_recommended" ? "#d97706" : "#64748b",
            boxShadow: activeTab === "review_recommended" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
            cursor: "pointer",
          }}
        >
          Review Recommended ({reviewRecommendedCount})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "informational"}
          onClick={() => setActiveTab("informational")}
          style={{
            padding: "0.45rem 0.25rem",
            fontSize: "0.78rem",
            fontWeight: 600,
            borderRadius: "6px",
            border: "none",
            background: activeTab === "informational" ? "#ffffff" : "transparent",
            color: activeTab === "informational" ? "#2563eb" : "#64748b",
            boxShadow: activeTab === "informational" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
            cursor: "pointer",
          }}
        >
          Informational ({informationalCount})
        </button>
      </div>

      {/* List Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "1rem" }}>
        {filtered.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "3rem 1rem",
              color: "#64748b",
            }}
          >
            <span style={{ fontSize: "2.5rem", display: "block", marginBottom: "0.5rem" }}>
              🎉
            </span>
            <p style={{ margin: 0, fontWeight: 600, color: "#1e293b" }}>All caught up!</p>
            <p style={{ margin: "0.25rem 0 0", fontSize: "0.85rem" }}>
              No active {activeTab.replace("_", " ")} items at this time.
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {filtered.map((item) => (
              <div
                key={item.id}
                style={{
                  background: "#ffffff",
                  border: `1.5px solid ${item.priority === "critical" ? "#fca5a5" : item.priority === "high" ? "#fed7aa" : "#e2e8f0"}`,
                  borderRadius: "8px",
                  padding: "0.85rem",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: "0.5rem",
                    marginBottom: "0.35rem",
                  }}
                >
                  <strong style={{ fontSize: "0.92rem", color: "#0f172a" }}>{item.title}</strong>
                  <button
                    type="button"
                    onClick={() => handleDismiss(item.id)}
                    aria-label={`Dismiss ${item.title}`}
                    style={{
                      background: "none",
                      border: "none",
                      color: "#94a3b8",
                      fontSize: "0.8rem",
                      cursor: "pointer",
                      padding: "0.1rem 0.3rem",
                    }}
                  >
                    Dismiss
                  </button>
                </div>
                <p style={{ margin: 0, fontSize: "0.82rem", color: "#475569", lineHeight: 1.4 }}>
                  {item.explanationDetails || item.reason}
                </p>
                {item.tripTitle && (
                  <p
                    style={{
                      margin: "0.35rem 0 0",
                      fontSize: "0.75rem",
                      color: "#64748b",
                      fontWeight: 500,
                    }}
                  >
                    🏕️ {item.tripTitle}
                  </p>
                )}
                <div
                  style={{
                    marginTop: "0.65rem",
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: "0.5rem",
                  }}
                >
                  <Link
                    to={item.actionUrl}
                    onClick={onClose}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px",
                      padding: "0.3rem 0.65rem",
                      background: item.priority === "critical" ? "#ef4444" : "#0284c7",
                      color: "#ffffff",
                      fontSize: "0.78rem",
                      fontWeight: 600,
                      borderRadius: "4px",
                      textDecoration: "none",
                    }}
                  >
                    Take Action →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      {activeNotifications.length > 0 && (
        <div
          style={{
            padding: "0.75rem 1.25rem",
            borderTop: "1px solid #e2e8f0",
            background: "#f8fafc",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <button
            type="button"
            onClick={handleMarkAllRead}
            style={{
              background: "none",
              border: "none",
              color: "#2563eb",
              fontSize: "0.8rem",
              fontWeight: 600,
              cursor: "pointer",
              padding: "0.25rem",
            }}
          >
            Mark all as read
          </button>
          <span style={{ fontSize: "0.75rem", color: "#64748b" }}>
            {activeNotifications.length} unread
          </span>
        </div>
      )}
    </div>
  );
}
