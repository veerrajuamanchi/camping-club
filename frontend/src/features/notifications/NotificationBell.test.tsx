import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { NotificationBell } from "./NotificationBell";

const mockCalendar = {
  trips: [
    {
      tripId: "trip-notif-1",
      title: "Pinnacles Spring Trip",
      eventStatus: "confirmed",
      startsOn: "2026-11-20",
      endsOn: "2026-11-22",
      pollDeadlineAt: "2026-11-06T23:59:59Z",
      depositStatus: "unpaid", // Triggers ACT-MEM-DEP
      myRsvp: { response: "coming" },
    },
  ],
};

vi.mock("../../lib/supabase", () => ({
  invokeTripApi: vi.fn().mockImplementation((action: string) => {
    if (action === "get_calendar") {
      return Promise.resolve(mockCalendar);
    }
    return Promise.resolve({});
  }),
  invokeMemberApi: vi.fn().mockImplementation((action: string) => {
    if (action === "list_access_requests") {
      return Promise.resolve({ requests: [] });
    }
    return Promise.resolve({});
  }),
}));

describe("NotificationBell", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders bell icon button and active unread badge", async () => {
    render(
      <MemoryRouter>
        <NotificationBell memberId="mem-1" role="member" />
      </MemoryRouter>
    );

    const bellBtn = screen.getByRole("button", { name: /notifications/i });
    expect(bellBtn).toBeInTheDocument();

    const badge = await screen.findByTestId("notification-unread-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("2");
  });

  it("toggles the NotificationDrawer on click", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <NotificationBell memberId="mem-1" role="member" />
      </MemoryRouter>
    );

    const bellBtn = screen.getByRole("button", { name: /notifications/i });
    await user.click(bellBtn);

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Notifications")).toBeInTheDocument();
  });
});
