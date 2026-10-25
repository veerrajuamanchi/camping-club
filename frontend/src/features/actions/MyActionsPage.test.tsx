import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { MyActionsPage } from "./MyActionsPage";
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

describe("MyActionsPage", () => {
  it("shows loading indicator while fetching calendar data", () => {
    const api = vi.fn(() => new Promise<Calendar>(() => {}));
    render(
      <MemoryRouter>
        <MyActionsPage api={api as unknown as TripApi} />
      </MemoryRouter>
    );
    expect(screen.getByRole("status")).toHaveTextContent(/Loading your personal task inbox/i);
  });

  it("displays error message if calendar fetch fails", async () => {
    const api = vi.fn(async () => {
      throw new Error("Network error connecting to Supabase");
    });
    render(
      <MemoryRouter>
        <MyActionsPage api={api as unknown as TripApi} />
      </MemoryRouter>
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Network error connecting to Supabase");
  });

  it("displays empty state when all trips have no pending actions", async () => {
    const calendar = makeMockCalendar([]);
    const api = vi.fn(async () => calendar);
    render(
      <MemoryRouter>
        <MyActionsPage api={api as unknown as TripApi} />
      </MemoryRouter>
    );
    expect(await screen.findByTestId("actions-empty-state")).toBeInTheDocument();
    expect(screen.getByText("You're All Caught Up!")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Explore Camping Trips →/i })).toHaveAttribute("href", "/");
  });

  it("categorizes actions by urgency and displays daily workload deficit explanation", async () => {
    const trip1 = {
      tripId: "trip-nov",
      title: "November Monterey Camping",
      monthKey: "2026-11",
      eventStatus: "confirmed",
      startsOn: "2026-11-13",
      endsOn: "2026-11-15",
      pollDeadlineAt: "2026-11-01T18:00:00-08:00",
      currentRuleBundle: { id: "b1", version: 1, contentHash: "hash-1", rules: [], createdAt: "2026-10-01" },
      myRsvp: {
        response: "coming" as const,
        acknowledgmentId: "ack-1",
        version: 1,
        updatedAt: "2026-10-15",
        acceptedRuleBundle: { id: "b1", version: 1, contentHash: "hash-1", rules: [], createdAt: "2026-10-01" },
      },
      depositStatus: "confirmed",
      myDailyWorkload: {
        target: 2.0,
        days: [
          { date: "2026-11-13", selectedWeight: 2.0, status: "complete" },
          { date: "2026-11-14", selectedWeight: 1.0, status: "needs_selection" },
          { date: "2026-11-15", selectedWeight: 3.0, status: "complete" },
        ],
      },
      comingCount: 8,
      minimumParticipants: 4,
    };

    const trip2 = {
      tripId: "trip-dec",
      title: "December Pinnacles Camping",
      monthKey: "2026-12",
      eventStatus: "confirmed",
      startsOn: "2026-12-11",
      endsOn: "2026-12-13",
      pollDeadlineAt: "2026-11-20T18:00:00-08:00",
      currentRuleBundle: { id: "b1", version: 1, contentHash: "hash-1", rules: [], createdAt: "2026-10-01" },
      myRsvp: {
        response: "coming" as const,
        acknowledgmentId: "ack-2",
        version: 1,
        updatedAt: "2026-10-15",
        acceptedRuleBundle: { id: "b1", version: 1, contentHash: "hash-1", rules: [], createdAt: "2026-10-01" },
      },
      depositStatus: "unsubmitted", // Missing deposit!
      myDutyCount: 2,
      taskQuotaTarget: 2,
      comingCount: 6,
      minimumParticipants: 4,
    };

    const calendar = makeMockCalendar([trip1, trip2]);
    const api = vi.fn(async () => calendar);

    render(
      <MemoryRouter>
        <MyActionsPage api={api as unknown as TripApi} />
      </MemoryRouter>
    );

    // Section header
    expect(await screen.findByRole("heading", { name: /🚨 Action Required \(2\)/i })).toBeInTheDocument();

    // Check Action 1: Duty deficit (Trip 1)
    expect(screen.getByText(/Select Daily Responsibilities/i)).toBeInTheDocument();
    expect(screen.getByText(/2 of 3 days complete · Saturday needs 1.0×/i)).toBeInTheDocument();

    // Check Action 2: Deposit due (Trip 2)
    expect(screen.getByText(/Submit \$50 Cabin Deposit/i)).toBeInTheDocument();

    // Verify resolve links
    const resolveLinks = screen.getAllByRole("link", { name: "Resolve Action →" });
    expect(resolveLinks.length).toBe(2);
    expect(resolveLinks[0]).toHaveAttribute("href", "/trips/trip-nov?tab=tasks");
    expect(resolveLinks[1]).toHaveAttribute("href", "/trips/trip-dec?tab=financials");
  });
});
