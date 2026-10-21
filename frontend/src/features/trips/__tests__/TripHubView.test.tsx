import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { EventDetailsPage } from "../EventDetailsPage";
import { TripTasksAndMealsTab } from "../TripTasksAndMealsTab";

const mockTripHubData = {
  tripId: "trip-hub-1",
  monthKey: "2026-12",
  title: "Big Basin Redwoods Spring Camp",
  eventStatus: "confirmed" as const,
  tripStatus: "confirmed" as const,
  pollStatus: "closed" as const,
  startsOn: "2026-12-05",
  endsOn: "2026-12-07",
  minimumParticipants: 4,
  depositAmountCents: 5000,
  cabinPayerMemberId: "m-payer",
  depositStatus: "unpaid" as "unpaid" | "submitted_by_member" | "confirmed" | "exempt",
  comingCount: 4,
  spotsRemaining: 2,
  waitlistCount: 0,
  myWaitlistPosition: null,
  myDutyCount: 1,
  taskQuotaTarget: 2,
  myDailyWorkload: {
    target: 2.0,
    satisfied: false,
    tripVersion: 1,
    days: [
      {
        date: "2026-12-05",
        status: "action_needed",
        selectedWeight: 1.0,
        eligibleRemainingWeight: 2.0,
        unmetReason: "below_target",
      },
    ],
  },
  myRsvp: {
    response: "coming" as "coming" | "not_coming",
    version: 1,
    acknowledgmentId: "ack-1" as string | null,
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
  rulesMarkdown: "# Camping Constitution\n\n1. Respect quiet hours after 10 PM.\n2. Keep camp clean.",
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
      tripId: "trip-hub-1",
      category: "gear",
      itemName: "Propane Stove",
      quantityDescription: "2-burner",
      assignedMemberId: "m-user",
      assignedMemberName: "Current Member",
      isCritical: true,
      commitmentType: "shared_volunteer",
      isActive: true,
      isMine: true,
    },
    {
      id: "c-2",
      tripId: "trip-hub-1",
      category: "food",
      itemName: "Pancake Mix",
      quantityDescription: "2 boxes",
      assignedMemberId: null,
      assignedMemberName: null,
      isCritical: false,
      commitmentType: "shared_volunteer",
      isActive: true,
      isMine: false,
    },
    {
      id: "c-3",
      tripId: "trip-hub-1",
      category: "gear",
      itemName: "Sleeping Bag (30°F)",
      quantityDescription: "1 per person",
      assignedMemberId: null,
      assignedMemberName: null,
      isCritical: true,
      commitmentType: "individual_pack",
      isActive: true,
      isMine: false,
    },
    {
      id: "c-4",
      tripId: "trip-hub-1",
      category: "gear",
      itemName: "Headlamp / Flashlight",
      quantityDescription: "1 per person",
      assignedMemberId: null,
      assignedMemberName: null,
      isCritical: true,
      commitmentType: "individual_pack",
      isActive: true,
      isMine: false,
    },
  ],
  commitments: {
    individualPack: [
      {
        id: "c-3",
        tripId: "trip-hub-1",
        category: "gear",
        itemName: "Sleeping Bag (30°F)",
        quantityDescription: "1 per person",
        isCritical: true,
        commitmentType: "individual_pack",
        isActive: true,
      },
      {
        id: "c-4",
        tripId: "trip-hub-1",
        category: "gear",
        itemName: "Headlamp / Flashlight",
        quantityDescription: "1 per person",
        isCritical: true,
        commitmentType: "individual_pack",
        isActive: true,
      },
    ],
    sharedVolunteer: [
      {
        id: "c-1",
        tripId: "trip-hub-1",
        category: "gear",
        itemName: "Propane Stove",
        quantityDescription: "2-burner",
        assignedMemberId: "m-user",
        assignedMemberName: "Current Member",
        isCritical: true,
        commitmentType: "shared_volunteer",
        isActive: true,
        isMine: true,
      },
      {
        id: "c-2",
        tripId: "trip-hub-1",
        category: "food",
        itemName: "Pancake Mix",
        quantityDescription: "2 boxes",
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
    { memberId: "m-user", displayName: "Current Member", response: "coming", depositStatus: "unpaid" },
    { memberId: "m-payer", displayName: "Pat Payer", response: "coming", depositStatus: "exempt" },
    { memberId: "m-other", displayName: "Sam Pending", response: "coming", depositStatus: "submitted_by_member" },
  ],
  waitlistEntries: [],
  version: 1,
};

function renderTripHub(uiData = mockTripHubData, isAdmin = false, currentMemberId = "m-user", apiMock?: any) {
  const defaultMock = vi.fn().mockImplementation((action: string) => {
    if (action === "get_trip_details") return Promise.resolve(uiData);
    if (action === "get_constitution") return Promise.resolve({ definitions: [] });
    if (action === "get_trip_task_matrix") return Promise.resolve({ timeSlots: [], activeAssignments: [], driverCredits: [], myQuotaProgress: null, confirmedAttendees: [] });
    if (action === "get_trip_financials") return Promise.resolve({ expenses: [], carpoolReimbursements: [], cabinDeposit: null, settlementRun: null, balances: [], transfers: [], isFinalized: false });
    return Promise.resolve({});
  });

  const api = (action: string, input?: any) => {
    if (apiMock) {
      const res = apiMock(action, input);
      if (res !== undefined) return res;
    }
    return defaultMock(action);
  };

  const result = render(
    <MemoryRouter initialEntries={["/trips/trip-hub-1"]}>
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

  return { ...result, api };
}

describe("Task 5: Frontend 'My Trip Hub' Dashboard Refactor", () => {
  it("renders 'Required From You' banner with RSVP, $50 deposit toggle, and chores progress", async () => {
    renderTripHub();

    expect(await screen.findByRole("heading", { name: /Required From You/i })).toBeInTheDocument();

    // Check RSVP status row
    expect(screen.getByTestId("hub-rsvp-row")).toBeInTheDocument();
    expect(within(screen.getByTestId("hub-rsvp-row")).getByText(/Going/i)).toBeInTheDocument();

    // Check $50 Deposit row with 'I Have Sent $50' button for unpaid deposit
    const depositRow = screen.getByTestId("hub-deposit-row");
    expect(depositRow).toBeInTheDocument();
    expect(within(depositRow).getByRole("button", { name: /I Have Sent \$50/i })).toBeInTheDocument();

    // Check Daily Chores status row
    const choresRow = screen.getByTestId("hub-chores-row");
    expect(choresRow).toBeInTheDocument();
    expect(within(choresRow).getByText(/Action Needed/i)).toBeInTheDocument();
  });

  it("clicking 'I Have Sent $50' triggers submit_deposit API call and updates status to submitted", async () => {
    const user = userEvent.setup();
    const apiMock = vi.fn().mockImplementation((action: string) => {
      if (action === "get_trip_details") return Promise.resolve(mockTripHubData);
      if (action === "submit_deposit") return Promise.resolve({ success: true });
      if (action === "get_constitution") return Promise.resolve({ definitions: [] });
      return Promise.resolve({});
    });

    renderTripHub(mockTripHubData, false, "m-user", apiMock);

    const depositBtn = await screen.findByRole("button", { name: /I Have Sent \$50/i });
    await user.click(depositBtn);

    expect(apiMock).toHaveBeenCalledWith("submit_deposit", {
      tripId: "trip-hub-1",
    });
  });

  it("displays 'Exempt (Cabin Payer)' for the assigned cabin payer member", async () => {
    const payerData = {
      ...mockTripHubData,
      cabinPayerMemberId: "m-user",
      depositStatus: "exempt" as const,
    };

    renderTripHub(payerData, false, "m-user");

    const depositRow = await screen.findByTestId("hub-deposit-row");
    expect(within(depositRow).getByText(/Exempt \(Cabin Payer\)/i)).toBeInTheDocument();
    expect(within(depositRow).queryByRole("button", { name: /I Have Sent \$50/i })).not.toBeInTheDocument();
  });

  it("renders 'Trip To-Do & Contributions (Voluntary)' section with shared gear, food, packing checklist, and expense shortcut", async () => {
    renderTripHub();

    expect(await screen.findByRole("heading", { name: /Trip To-Do & Contributions/i })).toBeInTheDocument();

    // Shared Gear Card
    const gearCard = screen.getByTestId("todo-shared-gear");
    expect(gearCard).toBeInTheDocument();
    expect(within(gearCard).getByText(/Propane Stove/i)).toBeInTheDocument();
    expect(within(gearCard).getByRole("button", { name: /\+ Claim More/i })).toBeInTheDocument();

    // Food & Groceries Card
    const foodCard = screen.getByTestId("todo-food-groceries");
    expect(foodCard).toBeInTheDocument();
    expect(within(foodCard).getByText(/1 open item needed/i)).toBeInTheDocument();
    expect(within(foodCard).getByRole("button", { name: /Volunteer Item/i })).toBeInTheDocument();

    // Personal Packing Checklist Card
    const packingCard = screen.getByTestId("todo-personal-packing");
    expect(packingCard).toBeInTheDocument();
    expect(within(packingCard).getByText(/2 items to bring/i)).toBeInTheDocument();
    expect(within(packingCard).getByRole("button", { name: /View List|View Packing Checklist/i })).toBeInTheDocument();

    // Shared Expenses Shortcut
    const expenseCard = screen.getByTestId("todo-shared-expense");
    expect(expenseCard).toBeInTheDocument();
    expect(within(expenseCard).getByRole("button", { name: /\+ Post Expense|\+ Record Shared Expense/i })).toBeInTheDocument();
  });

  it("opens personal packing checklist modal when clicking 'View List'", async () => {
    const user = userEvent.setup();
    renderTripHub();

    const viewListBtn = await screen.findByRole("button", { name: /View List|View Packing Checklist/i });
    await user.click(viewListBtn);

    // Modal should appear displaying individual packing items
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Sleeping Bag (30°F)")).toBeInTheDocument();
    expect(screen.getByText("Headlamp / Flashlight")).toBeInTheDocument();

    // Close modal
    const closeBtn = screen.getByRole("button", { name: /^Close$/i });
    await user.click(closeBtn);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("allows admin to verify member deposits in participant roster", async () => {
    const user = userEvent.setup();
    const apiMock = vi.fn().mockImplementation((action: string) => {
      if (action === "get_trip_details") return Promise.resolve(mockTripHubData);
      if (action === "verify_deposit") return Promise.resolve({ success: true });
      if (action === "get_constitution") return Promise.resolve({ definitions: [] });
      return Promise.resolve({});
    });

    renderTripHub(mockTripHubData, true, "m-user", apiMock);

    // In participant roster, find Sam Pending who has submitted_by_member
    expect(await screen.findByText("Sam Pending")).toBeInTheDocument();
    const samChip = screen.getByText("Sam Pending").closest(".attendee-chip")!;
    const verifyBtn = within(samChip as HTMLElement).getByRole("button", { name: /Verify Deposit|Confirm \$50/i });
    await user.click(verifyBtn);

    expect(apiMock).toHaveBeenCalledWith("verify_deposit", {
      tripId: "trip-hub-1",
      memberId: "m-other",
      status: "confirmed_by_admin",
    });
  });

  it("displays '✓ Target Met for [DayName]!' and greys out unselected chores in TripTasksAndMealsTab when 2.0x target reached", async () => {
    const apiMock = vi.fn().mockImplementation((action: string) => {
      if (action === "get_trip_task_matrix") {
        return Promise.resolve({
          timeSlots: [
            {
              id: "slot-1",
              trip_id: "trip-hub-1",
              slot_date: "2026-12-05",
              time_block: "morning",
              slot_type: "chore",
              label: "Saturday Morning Camp Setup",
              is_enabled: true,
              duties: [
                {
                  id: "duty-1",
                  time_slot_id: "slot-1",
                  capacity: 2,
                  workload_weight: 2.0,
                  is_active: true,
                  responsibility: { title: "Firewood & Kindling", description: "Collect and prep firewood" },
                },
                {
                  id: "duty-2",
                  time_slot_id: "slot-1",
                  capacity: 2,
                  workload_weight: 1.0,
                  is_active: true,
                  responsibility: { title: "Water Supply Refill", description: "Fetch water jugs" },
                },
              ],
            },
          ],
          activeAssignments: [
            {
              id: "assign-1",
              slot_duty_id: "duty-1",
              member_id: "m-user",
              member: { display_name: "Current Member" },
            },
          ],
          driverCredits: [],
          myQuotaProgress: {
            claimed_count: 1,
            claimed_weight: 2.0,
            driver_credit: 0,
            total_score: 2.0,
            quota_target: 2,
            target_reached: true,
          },
          myDailyWorkload: {
            target: 2.0,
            satisfied: true,
            tripVersion: 1,
            days: [
              {
                date: "2026-12-05",
                status: "target_met",
                selectedWeight: 2.0,
                eligibleRemainingWeight: 1.0,
              },
            ],
          },
          confirmedAttendees: [
            { memberId: "m-user", displayName: "Current Member" },
          ],
        });
      }
      return Promise.resolve({});
    });

    render(
      <TripTasksAndMealsTab
        tripId="trip-hub-1"
        isConfirmedAttendee={true}
        isAdmin={false}
        currentMemberId="m-user"
        api={apiMock}
      />
    );

    // Day banner should display Target Met for Saturday
    expect(await screen.findByText(/✓ Target Met for Saturday!/i)).toBeInTheDocument();

    // The user's claimed chore (duty-1) should have 'Drop Task' enabled
    expect(screen.getByRole("button", { name: /Drop Task/i })).toBeEnabled();

    // The unselected chore (duty-2) should be greyed out and disabled
    const disabledBtn = screen.getByRole("button", { name: /Done for Day/i });
    expect(disabledBtn).toBeDisabled();
  });

  it("displays non-attending banner message when user RSVP is not_coming", async () => {
    const notComingData = {
      ...mockTripHubData,
      myRsvp: {
        response: "not_coming" as const,
        version: 1,
        acknowledgmentId: null,
        updatedAt: "2026-10-01T00:00:00Z",
      },
    };

    renderTripHub(notComingData);

    expect(await screen.findByText(/You're not attending this event\. No tasks or deposits required\./i)).toBeInTheDocument();
    expect(screen.queryByTestId("hub-deposit-row")).not.toBeInTheDocument();
    expect(screen.queryByTestId("hub-chores-row")).not.toBeInTheDocument();
  });

  it("closes personal packing checklist modal on Escape key press", async () => {
    const user = userEvent.setup();
    renderTripHub();

    const viewListBtn = await screen.findByRole("button", { name: /View List|View Packing Checklist/i });
    await user.click(viewListBtn);

    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    // Press Escape
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
