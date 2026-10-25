import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { EventDetailsPage } from "./EventDetailsPage";

vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({
    membership: { status: "active", role: "admin", displayName: "Test Admin" },
    profile: { memberId: "m1", displayName: "Test Admin", role: "admin" },
    refresh: vi.fn(),
    signOut: vi.fn(),
  }),
}));

describe("EventDetailsPage Lifecycle & Health", () => {
  it("renders Trip Health card with discrete status badge and expandable exceptions", async () => {
    const user = userEvent.setup();
    const mockApi = vi.fn().mockImplementation((action: string) => {
      if (action === "get_trip_details") {
        return Promise.resolve({
          tripId: "trip-health-1",
          monthKey: "2026-11",
          title: "Lake Tahoe Autumn Camp",
          eventStatus: "confirmed",
          startsOn: "2026-11-20",
          endsOn: "2026-11-22",
          pollDeadlineAt: "2026-11-06T23:59:59Z",
          minimumParticipants: 4,
          comingCount: 2, // < 4 participants triggers needs_attention or at_risk
          cabinBookingStatus: "pending",
          depositAmountCents: 5000,
          myRsvp: { response: "coming" },
          campsite: { name: "Tahoe State Park", directions: "Highway 89 North" },
        });
      }
      if (action === "get_constitution") return Promise.resolve({ definitions: [] });
      if (action === "get_trip_activities") return Promise.resolve({ activities: [] });
      return Promise.resolve({});
    });

    render(
      <MemoryRouter initialEntries={["/trips/trip-health-1"]}>
        <Routes>
          <Route path="/trips/:tripId" element={<EventDetailsPage api={mockApi} isAdmin={true} />} />
        </Routes>
      </MemoryRouter>
    );

    // Verify Trip Health hero badge
    const heroBadge = await screen.findByTestId("trip-health-hero-badge");
    expect(heroBadge).toBeInTheDocument();
    expect(heroBadge).toHaveTextContent(/Needs Attention/i);

    // Verify Trip Health card accordion
    const healthCard = screen.getByTestId("trip-health-card");
    expect(healthCard).toBeInTheDocument();
    expect(screen.getByTestId("trip-health-status-badge")).toHaveTextContent(/Needs Attention/i);

    // Expand accordion to review exceptions
    const summary = healthCard.querySelector("summary");
    expect(summary).toBeInTheDocument();
    if (summary) {
      await user.click(summary);
    }

    // Verify exception text explaining "Why?" and "Action Required"
    expect(screen.getByText(/Cabin booking status or critical trip readiness records are unconfirmed or stale/i)).toBeInTheDocument();
    expect(screen.getByText(/Action:/i)).toBeInTheDocument();
  });

  it("renders Active Camping banner with directions and camp host contact when on-site", async () => {
    const mockApi = vi.fn().mockImplementation((action: string) => {
      if (action === "get_trip_details") {
        return Promise.resolve({
          tripId: "trip-active-1",
          monthKey: "2026-11",
          title: "Big Basin Active Camp",
          eventStatus: "in_progress", // Active camping phase
          startsOn: "2026-11-01",
          endsOn: "2026-11-03",
          cabinBookingStatus: "booked",
          minimumParticipants: 4,
          comingCount: 5,
          myRsvp: { response: "coming" },
          campsite: {
            name: "Big Basin Redwoods",
            directions: "Take CA-9 to CA-236 W",
            campHostName: "Ranger Dave",
            campHostPhone: "555-0199",
          },
        });
      }
      if (action === "get_constitution") return Promise.resolve({ definitions: [] });
      if (action === "get_trip_activities") return Promise.resolve({ activities: [] });
      return Promise.resolve({});
    });

    render(
      <MemoryRouter initialEntries={["/trips/trip-active-1"]}>
        <Routes>
          <Route path="/trips/:tripId" element={<EventDetailsPage api={mockApi} isAdmin={true} />} />
        </Routes>
      </MemoryRouter>
    );

    // Verify Active Camping banner
    const banner = await screen.findByTestId("active-camping-banner");
    expect(banner).toBeInTheDocument();
    expect(within(banner).getByText(/Currently Camping · On-Site Quick Access/i)).toBeInTheDocument();
    expect(within(banner).getByText(/Take CA-9 to CA-236 W/i)).toBeInTheDocument();
    expect(within(banner).getByText(/Ranger Dave \(555-0199\)/i)).toBeInTheDocument();

    // Verify hero badge
    expect(screen.getByTestId("trip-lifecycle-hero-badge")).toHaveTextContent("Currently Camping");
  });

  it("renders Post-Trip banner with direct settlement navigation when finalized", async () => {
    const mockApi = vi.fn().mockImplementation((action: string) => {
      if (action === "get_trip_details") {
        return Promise.resolve({
          tripId: "trip-post-1",
          monthKey: "2026-10",
          title: "Completed Big Sur Camp",
          eventStatus: "financially_finalized", // Post-trip phase
          startsOn: "2026-10-10",
          endsOn: "2026-10-12",
          cabinBookingStatus: "booked",
          minimumParticipants: 4,
          comingCount: 6,
          myRsvp: { response: "coming" },
          campsite: { name: "Pfeiffer Big Sur" },
        });
      }
      if (action === "get_constitution") return Promise.resolve({ definitions: [] });
      if (action === "get_trip_activities") return Promise.resolve({ activities: [] });
      if (action === "get_trip_financials") return Promise.resolve({
        expenses: [],
        settlement: { finalized: true, transfers: [] },
      });
      return Promise.resolve({});
    });

    render(
      <MemoryRouter initialEntries={["/trips/trip-post-1?tab=overview"]}>
        <Routes>
          <Route path="/trips/:tripId" element={<EventDetailsPage api={mockApi} isAdmin={true} />} />
        </Routes>
      </MemoryRouter>
    );

    // Verify Post-Trip banner
    const banner = await screen.findByTestId("post-trip-banner");
    expect(banner).toBeInTheDocument();
    expect(screen.getByText(/Post-Trip Reconciliation Active/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /View Settlements & Transfers/i })).toBeInTheDocument();
  });
});
