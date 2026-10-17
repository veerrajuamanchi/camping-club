import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { EventDetailsPage } from "./EventDetailsPage";

const baseTrip = {
  tripId: "11111111-1111-4111-8111-111111111111",
  monthKey: "2026-11",
  title: "Olympic National Park Camp",
  tripStatus: "rsvp_open",
  eventStatus: "rsvp_open",
  campingType: "cabin",
  taskQuotaTarget: 2,
  myDutyCount: 1,
  pollStatus: "open",
  startsOn: "2026-11-15",
  endsOn: "2026-11-17",
  pollDeadlineAt: "2026-11-10T18:00:00Z",
  clubTimezone: "America/Los_Angeles",
  minimumParticipants: 4,
  selectedCampsiteId: "22222222-2222-4222-8222-222222222222",
  cabinBookingStatus: "not_booked",
  additionalInformation: "Bring rain gear",
  comingCount: 5,
  effectiveCapacity: 12,
  spotsRemaining: 7,
  waitlistCount: 0,
  myWaitlistPosition: null,
  myRsvp: { response: "coming", version: 1, acknowledgmentId: "ack-1", updatedAt: "2026-10-15T00:00:00Z" },
  currentRuleBundle: { id: "bundle-1", version: 1, contentHash: "hash-1", rules: [], createdAt: "2026-10-15T00:00:00Z" },
  campsite: {
    campsiteId: "22222222-2222-4222-8222-222222222222",
    name: "Sol Duc Hot Springs",
    locationDescription: "Port Angeles, WA",
    availabilityUrl: null,
    perCabinCapacity: 6,
    cabinCount: 2,
  },
  perCabinCapacity: 6,
  cabinCount: 2,
  maxCapacity: 12,
  participantEntries: [{ memberId: "member-1", displayName: "Dave K.", response: "coming" }],
  waitlistEntries: [],
  version: 1,
};

function renderComponent(ui: React.ReactElement, tripId = baseTrip.tripId) {
  return render(
    <MemoryRouter initialEntries={[`/trips/${tripId}`]}>
      <Routes>
        <Route path="/trips/:tripId" element={ui} />
      </Routes>
    </MemoryRouter>
  );
}

describe("Phase 3: Trip Lifecycle & Cabin Reservation UI", () => {
  it("renders lifecycle status badge and smart action button for admin to confirm trip", async () => {
    const user = userEvent.setup();
    const mockApi = vi.fn().mockImplementation((action: string) => {
      if (action === "get_trip_details") return Promise.resolve(baseTrip);
      if (action === "get_constitution") return Promise.resolve({ definitions: [] });
      if (action === "admin_transition_trip_lifecycle") {
        return Promise.resolve({ success: true, to_status: "confirmed" });
      }
      return Promise.resolve({});
    });

    renderComponent(
      <EventDetailsPage isAdmin={true} currentMemberId="member-1" api={mockApi} />
    );

    // Initial status badge
    expect(await screen.findByText(/Event Status: RSVP Open/i)).toBeInTheDocument();

    // Admin should see Confirm Trip button
    const confirmBtn = await screen.findByRole("button", { name: /✓ Confirm Trip/i });
    expect(confirmBtn).toBeInTheDocument();

    await user.click(confirmBtn);

    expect(mockApi).toHaveBeenCalledWith(
      "admin_transition_trip_lifecycle",
      expect.objectContaining({
        tripId: baseTrip.tripId,
        toStatus: "confirmed",
      })
    );
  });

  it("advances lifecycle through sequential stages when confirmed", async () => {
    const confirmedTrip = {
      ...baseTrip,
      tripStatus: "confirmed",
      eventStatus: "confirmed",
      cabinBookingStatus: "booked",
    };

    const mockApi = vi.fn().mockImplementation((action: string) => {
      if (action === "get_trip_details") return Promise.resolve(confirmedTrip);
      if (action === "get_constitution") return Promise.resolve({ definitions: [] });
      return Promise.resolve({});
    });

    renderComponent(
      <EventDetailsPage isAdmin={true} currentMemberId="member-1" api={mockApi} />
    );

    expect(await screen.findByText(/Event Status: Confirmed/i)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /🚀 Start Trip/i })).toBeInTheDocument();
  });

  it("hides administrative lifecycle controls for non-admin members", async () => {
    const mockApi = vi.fn().mockImplementation((action: string) => {
      if (action === "get_trip_details") return Promise.resolve(baseTrip);
      if (action === "get_constitution") return Promise.resolve({ definitions: [] });
      return Promise.resolve({});
    });

    renderComponent(
      <EventDetailsPage isAdmin={false} currentMemberId="member-1" api={mockApi} />
    );

    expect(await screen.findByText(/Event Status: RSVP Open/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /✓ Confirm Trip/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /✏️ Edit Event/i })).not.toBeInTheDocument();
  });

  it("displays completed and financially finalized statuses accurately", async () => {
    const completedTrip = {
      ...baseTrip,
      tripStatus: "completed",
      eventStatus: "completed",
    };

    const mockApi = vi.fn().mockImplementation((action: string) => {
      if (action === "get_trip_details") return Promise.resolve(completedTrip);
      if (action === "get_constitution") return Promise.resolve({ definitions: [] });
      return Promise.resolve({});
    });

    renderComponent(
      <EventDetailsPage isAdmin={true} currentMemberId="member-1" api={mockApi} />
    );

    expect(await screen.findByText(/Event Status: Completed/i)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /🔒 Finalize Finances/i })).toBeInTheDocument();
  });
});
