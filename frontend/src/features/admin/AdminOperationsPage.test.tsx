import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { AdminOperationsPage } from "./AdminOperationsPage";
import type { Calendar, TripApi } from "../trips/TripCalendarPage";

function makeMockCalendar(trips: unknown[] = []): Calendar {
  return {
    clubConfiguration: {
      timezone: "America/Los_Angeles",
      defaultPollLeadDays: 35,
      defaultPollCloseTime: "18:00:00",
      defaultMinimumParticipants: 4,
      nextMonthToGenerate: "2027-02",
      nextRotationPosition: 1,
      version: 1,
    },
    campsites: [],
    trips: trips as Calendar["trips"],
  };
}

describe("AdminOperationsPage", () => {
  it("shows loading indicator while fetching admin operations data", () => {
    const api = vi.fn(() => new Promise<Calendar>(() => {}));
    render(
      <MemoryRouter>
        <AdminOperationsPage api={api as unknown as TripApi} />
      </MemoryRouter>
    );
    expect(screen.getByRole("status")).toHaveTextContent(/Loading operational exceptions/i);
  });

  it("displays error message if calendar fetch fails", async () => {
    const api = vi.fn(async () => {
      throw new Error("Database query timeout");
    });
    render(
      <MemoryRouter>
        <AdminOperationsPage api={api as unknown as TripApi} />
      </MemoryRouter>
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Database query timeout");
  });

  it("displays empty state when all trips are on track with zero exceptions", async () => {
    const calendar = makeMockCalendar([]);
    const api = vi.fn(async () => calendar);
    const memberApi = vi.fn(async () => ({ requests: [] }));

    render(
      <MemoryRouter>
        <AdminOperationsPage api={api as unknown as TripApi} memberApi={memberApi as any} />
      </MemoryRouter>
    );

    expect(await screen.findByTestId("admin-ops-empty-state")).toBeInTheDocument();
    expect(screen.getByText("All Trips On Track")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Return to Calendar →/i })).toHaveAttribute("href", "/");
  });

  it("groups exceptions by trip and displays imminent cutoff quorum risks", async () => {
    // Cutoff in 3 days with only 3 confirmed RSVPs (below min 4)
    const inThreeDays = new Date();
    inThreeDays.setDate(inThreeDays.getDate() + 3);

    const trip1 = {
      tripId: "trip-risk",
      title: "November Monterey Camping",
      monthKey: "2026-11",
      eventStatus: "tentative",
      startsOn: "2026-11-20",
      endsOn: "2026-11-22",
      pollDeadlineAt: inThreeDays.toISOString(),
      depositStatus: "submitted_by_member", // Deposit awaiting verification!
      comingCount: 3,
      minimumParticipants: 4,
      waitlistCount: 0,
    };

    const calendar = makeMockCalendar([trip1]);
    const api = vi.fn(async () => calendar);
    const memberApi = vi.fn(async () => ({
      requests: [
        { memberId: "req-1", fullName: "Diana Prince", email: "diana@amazon.com" },
      ],
    }));

    render(
      <MemoryRouter>
        <AdminOperationsPage api={api as unknown as TripApi} memberApi={memberApi as any} />
      </MemoryRouter>
    );

    // Header counter badge
    expect(await screen.findByText(/🚨 1 Critical Action/i)).toBeInTheDocument();

    // Membership exception section
    expect(screen.getByText(/👥 Membership Access Requests \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Review Access Request: Diana Prince/i)).toBeInTheDocument();

    // Trip section
    expect(screen.getByTestId("admin-ops-trip-trip-risk")).toBeInTheDocument();
    expect(screen.getByText(/Cutoff Imminent \(3\/4 Confirmed\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Verify \$50 Deposit: Member/i)).toBeInTheDocument();

    // Deep link action buttons
    const actionLinks = screen.getAllByRole("link", { name: "Manage Exception →" });
    expect(actionLinks.length).toBe(3);
    expect(actionLinks[0]).toHaveAttribute("href", "/admin/members?filter=pending");
    expect(actionLinks[1]).toHaveAttribute("href", "/trips/trip-risk?tab=overview&action=trip-controls");
  });
});
