import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { EventDetailsPage } from "../EventDetailsPage";
import { TripTasksAndMealsTab } from "../TripTasksAndMealsTab";

const mockTripDetailsNotComing = {
  tripId: "trip-guardrails-1",
  monthKey: "2026-12",
  title: "Big Basin Winter Retreat",
  eventStatus: "confirmed" as const,
  tripStatus: "confirmed" as const,
  pollStatus: "closed" as const,
  startsOn: "2026-12-05",
  endsOn: "2026-12-07",
  minimumParticipants: 4,
  depositAmountCents: 5000,
  cabinPayerMemberId: "m-payer",
  depositStatus: "unpaid" as const,
  comingCount: 4,
  spotsRemaining: 2,
  waitlistCount: 0,
  myWaitlistPosition: null,
  myDutyCount: 0,
  taskQuotaTarget: 2,
  myDailyWorkload: null,
  myRsvp: {
    response: "not_coming" as const,
    version: 1,
    acknowledgmentId: null,
    updatedAt: "2026-10-01T00:00:00Z",
  },
  currentRuleBundle: {
    id: "bundle-1",
    version: 1,
    contentHash: "hash123",
    rules: [
      { stable_key: "rule-1", text: "Respect quiet hours", category: "conduct", structured_values: {} },
    ],
    createdAt: "2026-10-01T00:00:00Z",
  },
  rulesMarkdown: "# Camping Constitution",
  campsite: {
    campsiteId: "site-1",
    name: "Big Basin Redwood Grove",
    locationDescription: "Boulder Creek, CA",
    cabinCapacity: 6,
    availabilityUrl: "https://example.com/site",
    directions: "Hwy 9 to Hwy 236",
    reservationInstructions: "Check in at ranger kiosk",
  },
  perCabinCapacity: 6,
  cabinCount: 2,
  maxCapacity: 12,
  commitmentsList: [
    {
      id: "c-1",
      tripId: "trip-guardrails-1",
      category: "gear",
      itemName: "Camp Stove",
      quantityDescription: "2-burner",
      assignedMemberId: null,
      assignedMemberName: null,
      isCritical: true,
      commitmentType: "shared_volunteer" as const,
      isActive: true,
      isMine: false,
    },
    {
      id: "c-2",
      tripId: "trip-guardrails-1",
      category: "food",
      itemName: "Coffee Grounds",
      quantityDescription: "2 bags",
      assignedMemberId: null,
      assignedMemberName: null,
      isCritical: false,
      commitmentType: "shared_volunteer" as const,
      isActive: true,
      isMine: false,
    },
    {
      id: "c-3",
      tripId: "trip-guardrails-1",
      category: "gear",
      itemName: "Personal Sleeping Bag",
      quantityDescription: "1",
      assignedMemberId: "m-user",
      assignedMemberName: "Current Member",
      isCritical: true,
      commitmentType: "individual_pack" as const,
      isActive: true,
      isMine: true,
    },
  ],
  commitments: {
    individualPack: [
      {
        id: "c-3",
        tripId: "trip-guardrails-1",
        category: "gear",
        itemName: "Personal Sleeping Bag",
        quantityDescription: "1",
        assignedMemberId: "m-user",
        assignedMemberName: "Current Member",
        isCritical: true,
        commitmentType: "individual_pack",
        isActive: true,
        isMine: true,
      },
    ],
    sharedVolunteer: [
      {
        id: "c-1",
        tripId: "trip-guardrails-1",
        category: "gear",
        itemName: "Camp Stove",
        quantityDescription: "2-burner",
        assignedMemberId: null,
        assignedMemberName: null,
        isCritical: true,
        commitmentType: "shared_volunteer",
        isActive: true,
        isMine: false,
      },
      {
        id: "c-2",
        tripId: "trip-guardrails-1",
        category: "food",
        itemName: "Coffee Grounds",
        quantityDescription: "2 bags",
        assignedMemberId: null,
        assignedMemberName: null,
        isCritical: false,
        commitmentType: "shared_volunteer",
        isActive: true,
        isMine: false,
      },
    ],
  },
  participantEntries: [
    { memberId: "m-payer", displayName: "Pat Payer", response: "coming", depositStatus: "exempt" },
    { memberId: "m-user", displayName: "Current Member", response: "not_coming", depositStatus: "unpaid" },
  ],
  waitlistEntries: [],
  version: 1,
};

function renderEventDetails(uiData = mockTripDetailsNotComing, isAdmin = false, currentMemberId = "m-user") {
  const api = vi.fn().mockImplementation((action: string) => {
    if (action === "get_trip_details") return Promise.resolve(uiData);
    if (action === "get_constitution") return Promise.resolve({ definitions: [] });
    if (action === "get_trip_task_matrix") {
      return Promise.resolve({
        timeSlots: [],
        activeAssignments: [],
        driverCredits: [],
        myQuotaProgress: null,
        confirmedAttendees: [],
      });
    }
    if (action === "get_trip_financials") {
      return Promise.resolve({
        expenses: [],
        carpoolReimbursements: [],
        cabinDeposit: null,
        settlementRun: null,
        balances: [],
        transfers: [],
        isFinalized: false,
      });
    }
    return Promise.resolve({});
  });

  return render(
    <MemoryRouter initialEntries={["/trips/trip-guardrails-1"]}>
      <Routes>
        <Route
          path="/trips/:tripId"
          element={
            <EventDetailsPage
              isAdmin={isAdmin}
              currentMemberId={currentMemberId}
              api={api}
            />
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

describe("Task 3: Not Going Strict Guardrails", () => {
  describe("EventDetailsPage with response: 'not_coming'", () => {
    it("renders clean Not Going status card and strictly hides deposit, chores, and meals rows", async () => {
      renderEventDetails();

      // Heading should show Required From You without count
      expect(await screen.findByRole("heading", { name: /⚡ Required From You/i })).toBeInTheDocument();
      expect(screen.queryByText(/of 3 Completed/i)).not.toBeInTheDocument();

      // RSVP row shows Not Going
      const rsvpRow = screen.getByTestId("hub-rsvp-row");
      expect(rsvpRow).toBeInTheDocument();
      expect(within(rsvpRow).getByText(/Not Going/i)).toBeInTheDocument();

      // Deposit, chores, and meals rows must NOT be rendered
      expect(screen.queryByTestId("hub-deposit-row")).not.toBeInTheDocument();
      expect(screen.queryByTestId("hub-chores-row")).not.toBeInTheDocument();
      expect(screen.queryByTestId("hub-meals-row")).not.toBeInTheDocument();
    });

    it("disables volunteer buttons in Trip To-Do & Contributions with guardrail title and notice", async () => {
      renderEventDetails();

      // Non-attendee notice in To-Do section
      expect(
        await screen.findByText(/Only confirmed Going attendees can volunteer for shared gear and groceries\./i)
      ).toBeInTheDocument();

      // Shared gear button is disabled with tooltip
      const claimGearBtn = screen.getByRole("button", { name: /\+ Claim Shared Gear|\+ Claim More/i });
      expect(claimGearBtn).toBeDisabled();
      expect(claimGearBtn).toHaveAttribute(
        "title",
        "Only confirmed Going attendees can volunteer for shared items"
      );

      // Volunteer grocery item button is disabled with tooltip
      const volunteerItemBtn = screen.getByRole("button", { name: /Volunteer Item/i });
      expect(volunteerItemBtn).toBeDisabled();
      expect(volunteerItemBtn).toHaveAttribute(
        "title",
        "Only confirmed Going attendees can volunteer for shared items"
      );
    });
  });

  describe("TripTasksAndMealsTab with isConfirmedAttendee={false}", () => {
    const mockTasksApi = vi.fn().mockImplementation((action: string) => {
      if (action === "get_trip_task_matrix") {
        return Promise.resolve({
          timeSlots: [
            {
              id: "slot-1",
              trip_id: "trip-guardrails-1",
              slot_date: "2026-12-05",
              time_block: "breakfast",
              slot_label: "Saturday Breakfast",
              sort_order: 1,
              is_enabled: true,
              duties: [
                {
                  id: "duty-1",
                  slot_id: "slot-1",
                  name: "Pancake Chef",
                  capacity: 2,
                  workload_weight: 1.0,
                  is_active: true,
                },
              ],
            },
          ],
          activeAssignments: [],
          driverCredits: [],
          myQuotaProgress: {
            claimed_count: 0,
            claimed_weight: 0,
            driver_credit: 0,
            total_score: 0,
            quota_target: 2,
            target_reached: false,
          },
          confirmedAttendees: [
            { memberId: "m-payer", displayName: "Pat Payer" },
          ],
        });
      }
      return Promise.resolve({});
    });

    it("displays non-attendee banner and hides personal quota card", async () => {
      const { container } = render(
        <TripTasksAndMealsTab
          tripId="trip-guardrails-1"
          isConfirmedAttendee={false}
          isAdmin={false}
          currentMemberId="m-user"
          api={mockTasksApi}
        />
      );

      // Banner with data-testid="not-attending-tasks-banner"
      const banner = await screen.findByTestId("not-attending-tasks-banner");
      expect(banner).toBeInTheDocument();
      expect(banner).toHaveTextContent(
        /You are viewing trip responsibilities as a non-attendee\. Only confirmed Going attendees can volunteer for meals and chores\./i
      );

      // Personal quota card is hidden
      expect(container.querySelector(".quota-progress-card")).toBeNull();
    });

    it("disables duty volunteer buttons with title 'Only confirmed Going attendees can volunteer'", async () => {
      render(
        <TripTasksAndMealsTab
          tripId="trip-guardrails-1"
          isConfirmedAttendee={false}
          isAdmin={false}
          currentMemberId="m-user"
          api={mockTasksApi}
        />
      );

      // Wait for duties to load
      const volunteerBtn = await screen.findByRole("button", { name: /^Volunteer$/i });
      expect(volunteerBtn).toBeDisabled();
      expect(volunteerBtn).toHaveAttribute(
        "title",
        "Only confirmed Going attendees can volunteer"
      );
    });
  });
});
