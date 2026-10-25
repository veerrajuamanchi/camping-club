import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { NotificationDrawer, type NotificationItem } from "./NotificationDrawer";

describe("NotificationDrawer", () => {
  const mockNotifications: NotificationItem[] = [
    {
      id: "notif-1",
      title: "Confirm Your Attendance",
      reason: "Russian River RSVP closes in 3 days",
      category: "action_required",
      priority: "critical",
      actionUrl: "/trips/trip-1",
      createdAt: "2026-11-01T12:00:00Z",
    },
    {
      id: "notif-2",
      title: "Select Duty Credit",
      reason: "Saturday meal clean-up duty missing",
      category: "review_recommended",
      priority: "normal",
      actionUrl: "/trips/trip-1?tab=prepare",
      createdAt: "2026-11-01T12:00:00Z",
    },
    {
      id: "notif-3",
      title: "Packing List Ready",
      reason: "Master packing checklist was synchronized",
      category: "informational",
      priority: "info",
      actionUrl: "/trips/trip-1?tab=prepare",
      createdAt: "2026-11-01T12:00:00Z",
    },
  ];

  beforeEach(() => {
    localStorage.clear();
  });

  it("renders when open and displays categorized tabs", () => {
    render(
      <MemoryRouter>
        <NotificationDrawer
          isOpen={true}
          onClose={vi.fn()}
          notifications={mockNotifications}
          memberId="member-123"
        />
      </MemoryRouter>
    );

    expect(screen.getByText("Notifications")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Action Required/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Review Recommended/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Informational/i })).toBeInTheDocument();
  });

  it("shows action required items by default and switches tabs", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <NotificationDrawer
          isOpen={true}
          onClose={vi.fn()}
          notifications={mockNotifications}
          memberId="member-123"
        />
      </MemoryRouter>
    );

    // Default tab is action_required
    expect(screen.getByText("Confirm Your Attendance")).toBeInTheDocument();
    expect(screen.queryByText("Select Duty Credit")).not.toBeInTheDocument();

    // Switch to Review Recommended
    await user.click(screen.getByRole("tab", { name: /Review Recommended/i }));
    expect(screen.getByText("Select Duty Credit")).toBeInTheDocument();
    expect(screen.queryByText("Confirm Your Attendance")).not.toBeInTheDocument();

    // Switch to Informational
    await user.click(screen.getByRole("tab", { name: /Informational/i }));
    expect(screen.getByText("Packing List Ready")).toBeInTheDocument();
  });

  it("dismisses a notification and persists to localStorage", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <NotificationDrawer
          isOpen={true}
          onClose={vi.fn()}
          notifications={mockNotifications}
          memberId="member-123"
        />
      </MemoryRouter>
    );

    expect(screen.getByText("Confirm Your Attendance")).toBeInTheDocument();
    const dismissBtn = screen.getByRole("button", { name: /Dismiss/i });
    await user.click(dismissBtn);

    expect(screen.queryByText("Confirm Your Attendance")).not.toBeInTheDocument();
    expect(localStorage.getItem("camping_club_dismissed_notifications_member-123")).toContain("notif-1");
  });

  it("marks all as read when button clicked", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <NotificationDrawer
          isOpen={true}
          onClose={vi.fn()}
          notifications={mockNotifications}
          memberId="member-123"
        />
      </MemoryRouter>
    );

    const markAllBtn = screen.getByRole("button", { name: /Mark all as read/i });
    await user.click(markAllBtn);

    expect(screen.getByText(/All caught up/i)).toBeInTheDocument();
  });
});
