import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { EventDetailsPage } from "./EventDetailsPage";
import type { DailyWorkload } from "./DailyWorkloadProgress";
import { TripApiError } from "../../lib/supabase";

const tripData = {
  tripId: "trip-1",
  myDailyWorkload: undefined as DailyWorkload | undefined,
  eventStatus: "tentative" as "tentative" | "confirmed" | "cancelled",
  minimumParticipants: 4,
  monthKey: "2026-12",
  pollStatus: "open" as "draft" | "open" | "closed",
  startsOn: "2026-12-05",
  endsOn: "2026-12-07",
  additionalInformation: "December Camping",
  comingCount: 3,
  effectiveCapacity: 12,
  spotsRemaining: 9,
  waitlistCount: 0,
  myWaitlistPosition: null,
  myRsvp: null as null | {
    response: "coming" | "not_coming";
    version: number;
    acknowledgmentId: string | null;
    updatedAt: string;
  },
  currentRuleBundle: {
    id: "bundle-1",
    version: 2,
    contentHash: "hash-123",
    rules: [
      { stable_key: "driver-mileage", text: "Driver mileage rule", category: "transport", structured_values: {} },
      { stable_key: "cabin-budget", text: "Cabin budget rule", category: "cabin", structured_values: {} },
      { stable_key: "car-wash", text: "Car wash rule", category: "expenses", structured_values: {} },
      { stable_key: "code-of-conduct", text: "Conduct rule", category: "conduct", structured_values: {} },
      { stable_key: "floor-lottery", text: "Floor lottery rule", category: "lodging", structured_values: {} },
      { stable_key: "participation-rule", text: "Participation rule", category: "participation", structured_values: {} },
      { stable_key: "meal-prep", text: "Meal prep rule", category: "meals", structured_values: {} },
      { stable_key: "packing-list", text: "Packing list rule", category: "custom", structured_values: {} },
    ],
    createdAt: "2026-10-01T00:00:00Z",
  },
  campsite: {
    campsiteId: "s1",
    name: "Pine Ridge",
    locationDescription: "Pine, CO",
    availabilityUrl: "https://example.com/campsite",
    directions: "Take Highway 285 South",
    cabinCapacity: 6,
    reservationInstructions: "Call the ranger station",
  },
  perCabinCapacity: 6,
  cabinCount: 2,
  maxCapacity: null,
  participantEntries: [
    { memberId: "m1", displayName: "Alice", response: "coming" },
    { memberId: "m2", displayName: "Bob", response: "coming" },
    { memberId: "m3", displayName: "Charlie", response: "coming" },
  ],
  waitlistEntries: [
    { memberId: "m4", displayName: "David", position: 1, createdAt: "2026-10-02T10:00:00Z" },
  ],
  version: 1,
};

function renderPage(
  uiData: typeof tripData = tripData,
  isAdmin = false,
  apiMock = vi.fn().mockImplementation((action: string) => {
    if (action === "get_trip_details") return Promise.resolve(uiData);
    if (action === "get_constitution") return Promise.resolve({ definitions: [] });
    if (action === "get_trip_task_matrix") return Promise.resolve({ timeSlots: [], activeAssignments: [], driverCredits: [], myQuotaProgress: null, confirmedAttendees: [] });
    if (action === "get_trip_financials") return Promise.resolve({ expenses: [], carpoolReimbursements: [], cabinDeposit: null, settlementRun: null, balances: [], transfers: [], isFinalized: false });
    return Promise.resolve({});
  }),
  initialRoute = "/trips/trip-1",
  userRole?: "member" | "admin" | "accountant",
  currentMemberId?: string
) {
  const result = render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <Routes>
        <Route
          path="/trips/:tripId"
          element={
            <EventDetailsPage
              isAdmin={isAdmin}
              api={apiMock}
              userRole={userRole}
              currentMemberId={currentMemberId}
            />
          }
        />
      </Routes>
    </MemoryRouter>
  );
  return { ...result, apiMock };
}

describe("EventDetailsPage", () => {
  it("renders Overview tab by default with trip and campsite details", async () => {
    renderPage();
    expect(await screen.findByText("December Camping")).toBeInTheDocument();
    expect(screen.getByText("Pine Ridge")).toBeInTheDocument();
    expect(screen.getByText("Pine, CO")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View campsite" })).toHaveAttribute("href", "https://example.com/campsite");
    expect(screen.getByText("3 confirmed")).toBeInTheDocument();
    expect(screen.getByText("9 spots remaining")).toBeInTheDocument();
    expect(screen.getByText("Capacity: 12")).toBeInTheDocument();
  });

  it("switches tabs and displays Constitution grouped into 4 categories", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("December Camping");

    await user.click(screen.getByRole("tab", { name: /constitution/i }));
    expect(screen.getByRole("heading", { name: /camping constitution/i })).toBeInTheDocument();
    expect(screen.getByText("Version 2")).toBeInTheDocument();

    // The 4 category groupings
    expect(screen.getByText("Travel & Cabin")).toBeInTheDocument();
    expect(screen.getByText("Food & Expenses")).toBeInTheDocument();
    expect(screen.getByText("Lodging & Responsibilities")).toBeInTheDocument();
    expect(screen.getByText("Packing & Meals")).toBeInTheDocument();

    // Verify rules inside groups
    expect(screen.getByText("Driver mileage rule")).toBeInTheDocument();
    expect(screen.getByText("Cabin budget rule")).toBeInTheDocument();
    expect(screen.getByText("Car wash rule")).toBeInTheDocument();
    expect(screen.getByText("Floor lottery rule")).toBeInTheDocument();
    expect(screen.getByText("Meal prep rule")).toBeInTheDocument();
    expect(screen.getByText("Packing list rule")).toBeInTheDocument();
  });

  it("displays acknowledged banner on Constitution tab when member has acknowledged", async () => {
    const user = userEvent.setup();
    const acknowledgedTrip = {
      ...tripData,
      myRsvp: {
        response: "coming" as const,
        version: 1,
        acknowledgmentId: "ack-1",
        updatedAt: "2026-10-02T00:00:00Z",
      },
    };
    renderPage(acknowledgedTrip);
    await screen.findByText("December Camping");

    await user.click(screen.getByRole("tab", { name: /constitution/i }));
    expect(screen.getByText("You acknowledged version 2.")).toBeInTheDocument();
  });

  it("switches to Logistics tab and displays additional information, instructions and directions", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("December Camping");

    await user.click(screen.getByRole("tab", { name: /logistics/i }));
    expect(screen.getByRole("heading", { name: /logistics/i })).toBeInTheDocument();
    expect(screen.getAllByText("December Camping")).toHaveLength(2);
    expect(screen.getByText("Call the ranger station")).toBeInTheDocument();
    expect(screen.getByText("Take Highway 285 South")).toBeInTheDocument();
  });

  it("switches to Financials tab and displays settlement and expenses", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("December Camping");

    await user.click(screen.getByRole("tab", { name: /financials/i }));
    expect(await screen.findByText(/settlement & expenses/i)).toBeInTheDocument();
    expect(screen.getByText(/settlement transfers/i)).toBeInTheDocument();
  });

  it("requires rule acknowledgment to submit Going RSVP", async () => {
    const user = userEvent.setup();
    const { apiMock } = renderPage();
    await screen.findByText("December Camping");

    await user.click(screen.getByRole("button", { name: "Going" }));
    expect(
      screen.getByText(/by selecting going you agree to the current camping constitution/i)
    ).toBeInTheDocument();

    // Confirm Going without checking checkbox
    await user.click(screen.getByRole("button", { name: "Confirm Going" }));
    expect(
      screen.getByText("Acknowledge the Camping Constitution before selecting Going.")
    ).toBeInTheDocument();
    expect(apiMock).not.toHaveBeenCalledWith("submit_rsvp", expect.anything());

    // Check acknowledgment and confirm
    await user.click(screen.getByLabelText(/i have read and agree to the camping constitution/i));
    await user.click(screen.getByRole("button", { name: "Confirm Going" }));

    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith("submit_rsvp", {
        tripId: "trip-1",
        response: "coming",
        expectedVersion: 0,
        bundleId: "bundle-1",
        contentHash: "hash-123",
      });
    });
  });

  it("submits Not Going RSVP without requiring acknowledgment", async () => {
    const user = userEvent.setup();
    const { apiMock } = renderPage();
    await screen.findByText("December Camping");

    await user.click(screen.getByRole("button", { name: "Not Going" }));
    await user.click(screen.getByRole("button", { name: "Confirm Not Going" }));

    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith("submit_rsvp", {
        tripId: "trip-1",
        response: "not_coming",
        expectedVersion: 0,
      });
    });
  });

  it("renders participant list and waitlist only for admins", async () => {
    // Non-admin view
    const { unmount } = renderPage(tripData, false);
    expect(await screen.findByText("Who's going (3)")).toBeInTheDocument();
    expect(screen.queryByText(/waitlist \(1\)/i)).not.toBeInTheDocument();
    unmount();

    // Admin view
    renderPage(tripData, true);
    expect(await screen.findByText("Who's going (3)")).toBeInTheDocument();
    expect(screen.getByText(/waitlist \(1\)/i)).toBeInTheDocument();
  });

  it("allows admin to toggle member attendance on attendee roster checklist", async () => {
    const user = userEvent.setup();
    const adminTripData = {
      ...tripData,
      allMemberEntries: [
        { memberId: "m1", displayName: "Alice", response: "coming", version: 1 },
        { memberId: "m2", displayName: "Bob", response: "not_coming", version: 0 },
      ],
    };
    const { apiMock } = renderPage(adminTripData, true);
    await screen.findByText("Admin: Manage Attendee Roster");

    // Find Bob's checkbox
    const bobCheckbox = screen.getByLabelText(/Bob/);
    expect(bobCheckbox).not.toBeChecked();

    await user.click(bobCheckbox);
    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith("admin_record_interest", {
        tripId: "trip-1",
        memberId: "m2",
        response: "coming",
        expectedVersion: 0,
        reason: "Administrator updated roster: marked Going",
      });
    });
  });

  it("handles API error when loading trip details", async () => {
    const errorApi = vi.fn().mockRejectedValue(new Error("Network error"));
    render(
      <MemoryRouter initialEntries={["/trips/trip-1"]}>
        <Routes>
          <Route path="/trips/:tripId" element={<EventDetailsPage isAdmin={false} api={errorApi} />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("Could not load trip details. Please try again.")).toBeInTheDocument();
  });

  it("displays waitlist notice when Going RSVP is waitlisted", async () => {
    const user = userEvent.setup();
    const apiMock = vi.fn().mockImplementation((action: string) => {
      if (action === "get_trip_details") return Promise.resolve(tripData);
      if (action === "get_constitution") return Promise.resolve({ definitions: [] });
      if (action === "submit_rsvp") return Promise.resolve({ waitlisted: true, position: 2 });
      return Promise.resolve({});
    });
    renderPage(tripData, false, apiMock);
    await screen.findByText("December Camping");

    await user.click(screen.getByRole("button", { name: "Going" }));
    await user.click(screen.getByLabelText(/i have read and agree to the camping constitution/i));
    await user.click(screen.getByRole("button", { name: "Confirm Going" }));

    expect(
      await screen.findByText("You are #2 on the waitlist. The administrator will notify you if a spot opens.")
    ).toBeInTheDocument();
  });

  it("allows admin to promote member from waitlist", async () => {
    const user = userEvent.setup();
    const { apiMock } = renderPage(tripData, true);
    await screen.findByText("December Camping");

    const promoteButton = screen.getByRole("button", { name: "Promote" });
    expect(promoteButton).toBeInTheDocument();

    await user.click(promoteButton);

    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith("admin_promote_from_waitlist", {
        tripId: "trip-1",
        memberId: "m4",
        reason: "Administrator promoted from waitlist",
      });
    });
  });

  it("displays capacity error message when promote from waitlist fails with TripApiError 409", async () => {
    const user = userEvent.setup();
    const apiMock = vi.fn().mockImplementation((action: string) => {
      if (action === "get_trip_details") return Promise.resolve(tripData);
      if (action === "get_constitution") return Promise.resolve({ definitions: [] });
      if (action === "admin_promote_from_waitlist") return Promise.reject(new TripApiError("trip_at_capacity", 409));
      return Promise.resolve({});
    });
    renderPage(tripData, true, apiMock);
    await screen.findByText("December Camping");

    const promoteButton = screen.getByRole("button", { name: "Promote" });
    await user.click(promoteButton);

    expect(
      await screen.findByText("Could not promote member. The trip may be at capacity.")
    ).toBeInTheDocument();
  });

  it("displays capacity error message when promote from waitlist fails with Error containing capacity", async () => {
    const user = userEvent.setup();
    const apiMock = vi.fn().mockImplementation((action: string) => {
      if (action === "get_trip_details") return Promise.resolve(tripData);
      if (action === "get_constitution") return Promise.resolve({ definitions: [] });
      if (action === "admin_promote_from_waitlist") return Promise.reject(new Error("Capacity reached"));
      return Promise.resolve({});
    });
    renderPage(tripData, true, apiMock);
    await screen.findByText("December Camping");

    const promoteButton = screen.getByRole("button", { name: "Promote" });
    await user.click(promoteButton);

    expect(
      await screen.findByText("Could not promote member. The trip may be at capacity.")
    ).toBeInTheDocument();
  });

  it("displays general error message when promote from waitlist fails with unexpected error", async () => {
    const user = userEvent.setup();
    const apiMock = vi.fn().mockImplementation((action: string) => {
      if (action === "get_trip_details") return Promise.resolve(tripData);
      if (action === "get_constitution") return Promise.resolve({ definitions: [] });
      if (action === "admin_promote_from_waitlist") return Promise.reject(new TripApiError("internal_error", 500));
      return Promise.resolve({});
    });
    renderPage(tripData, true, apiMock);
    await screen.findByText("December Camping");

    const promoteButton = screen.getByRole("button", { name: "Promote" });
    await user.click(promoteButton);

    expect(
      await screen.findByText("Could not promote member. Refresh and try again.")
    ).toBeInTheDocument();
  });

  it("displays Manage Meals & Chores button for admins and opens modal on click", async () => {
    const user = userEvent.setup();
    const apiMock = vi.fn().mockImplementation((action: string) => {
      if (action === "get_trip_details") return Promise.resolve(tripData);
      if (action === "get_constitution") return Promise.resolve({ definitions: [] });
      if (action === "get_trip_time_slots") return Promise.resolve({ timeSlots: [] });
      if (action === "admin_list_master_responsibilities") return Promise.resolve({ responsibilities: [] });
      return Promise.resolve({});
    });

    renderPage(tripData, true, apiMock);
    await screen.findByText("December Camping");

    const manageBtn = screen.getByRole("button", { name: "🍽️ Manage Meals & Chores" });
    expect(manageBtn).toBeInTheDocument();

    await user.click(manageBtn);
    expect(await screen.findByRole("dialog", { name: "Manage Meal & Chore Slots" })).toBeInTheDocument();
  });

  it("does not display Manage Meals & Chores button for non-admins", async () => {
    const apiMock = vi.fn().mockImplementation((action: string) => {
      if (action === "get_trip_details") return Promise.resolve(tripData);
      if (action === "get_constitution") return Promise.resolve({ definitions: [] });
      return Promise.resolve({});
    });

    renderPage(tripData, false, apiMock);
    await screen.findByText("December Camping");

    expect(screen.queryByRole("button", { name: "🍽️ Manage Meals & Chores" })).not.toBeInTheDocument();
  });

  it("opens directly to Tasks & Meals tab when URL has ?tab=tasks", async () => {
    const goingTripData = {
      ...tripData,
      myRsvp: { response: "coming" as const, version: 1, acknowledgmentId: "ack-1", updatedAt: "2026-10-14T00:00:00Z" },
    };
    renderPage(goingTripData, false, undefined, "/trips/trip-1?tab=tasks");
    expect(await screen.findByRole("heading", { name: "Your Trip Responsibility Progress" })).toBeInTheDocument();
  });

  it("prompts user with celebration modal on confirming Going and switches to Tasks tab on Choose My Duties Now", async () => {
    const user = userEvent.setup();
    const goingTripData = {
      ...tripData,
      myRsvp: { response: "coming" as const, version: 1, acknowledgmentId: "ack-1", updatedAt: "2026-10-14T00:00:00Z" },
    };

    const apiMock = vi.fn().mockImplementation((action: string) => {
      if (action === "get_trip_details") return Promise.resolve(tripData);
      if (action === "get_constitution") return Promise.resolve({ definitions: [] });
      if (action === "submit_rsvp") return Promise.resolve({ response: "coming", version: 1 });
      if (action === "get_trip_task_matrix") return Promise.resolve({ timeSlots: [], activeAssignments: [], driverCredits: [], myQuotaProgress: null, confirmedAttendees: [] });
      return Promise.resolve({});
    });

    renderPage(tripData, false, apiMock);
    await screen.findByText("December Camping");

    const goingBtn = screen.getByRole("button", { name: "Going" });
    await user.click(goingBtn);

    const checkbox = screen.getByRole("checkbox", { name: /I have read and agree/i });
    await user.click(checkbox);

    // Mock refresh to return going status
    apiMock.mockImplementation((action: string) => {
      if (action === "get_trip_details") return Promise.resolve(goingTripData);
      if (action === "get_constitution") return Promise.resolve({ definitions: [] });
      if (action === "get_trip_task_matrix") return Promise.resolve({ timeSlots: [], activeAssignments: [], driverCredits: [], myQuotaProgress: null, confirmedAttendees: [] });
      return Promise.resolve({});
    });

    const confirmBtn = screen.getByRole("button", { name: "Confirm Going" });
    await user.click(confirmBtn);

    expect(await screen.findByRole("heading", { name: /You're Going to December Camping! 🎉/i })).toBeInTheDocument();
    expect(screen.getAllByText(/camping duties/i).length).toBeGreaterThanOrEqual(1);

    const chooseDutiesBtn = screen.getByRole("button", { name: /Choose My Duties Now/i });
    await user.click(chooseDutiesBtn);

    // Modal closes and switches to Tasks tab
    expect(screen.queryByRole("heading", { name: /You're Going to December Camping! 🎉/i })).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Your Trip Responsibility Progress" })).toBeInTheDocument();
  });

  it("displays persistent duty badge and overview banner for incomplete duties and complete duties", async () => {
    const user = userEvent.setup();
    const incompleteTripData = {
      ...tripData,
      taskQuotaTarget: 2,
      myDutyCount: 1,
      myRsvp: { response: "coming" as const, version: 1, acknowledgmentId: "ack-1", updatedAt: "2026-10-14T00:00:00Z" },
    };

    renderPage(incompleteTripData, false);
    await screen.findByText("December Camping");

    // Hero badge
    const dutyBadgeBtn = screen.getByRole("button", { name: /⚠️ Duties: 1 of 2 selected · Choose Duties →/i });
    expect(dutyBadgeBtn).toBeInTheDocument();

    // Overview banner
    expect(screen.getByText(/Action Needed:/i)).toBeInTheDocument();
    expect(screen.getByText(/You have selected 1 of 2 camping duties/i)).toBeInTheDocument();

    // Clicking the overview link switches to tasks tab
    const chooseDutiesLink = screen.getByRole("button", { name: /Choose your duties now →/i });
    await user.click(chooseDutiesLink);
    expect(await screen.findByRole("heading", { name: "Your Trip Responsibility Progress" })).toBeInTheDocument();
  });

  it("displays cabin sites count and booking status in brackets in hero", async () => {
    const bookingTripData = {
      ...tripData,
      cabinCount: 2,
      perCabinCapacity: 8,
      effectiveCapacity: 16,
      campingType: "cabin" as const,
      cabinBookingStatus: "pending" as const,
    };

    renderPage(bookingTripData, false);
    await screen.findByText("December Camping");

    expect(screen.getByText(/2 cabin sites \(Pending Sites available\) · 8 people per site \(16 total spots\)/i)).toBeInTheDocument();
  });
  it("allows withdrawing from a confirmed closed poll and explains the late deposit", async () => {
    const user = userEvent.setup();
    const start = new Date(); start.setDate(start.getDate() + 15);
    const { apiMock } = renderPage({ ...tripData, pollStatus: "closed", eventStatus: "confirmed",
      startsOn: start.toISOString().slice(0, 10), endsOn: start.toISOString().slice(0, 10),
      myRsvp: { response: "coming", version: 2, acknowledgmentId: "ack-1", updatedAt: "2026-10-14T00:00:00Z" }, minimumParticipants: 4 }, false);
    await screen.findByText("December Camping");
    expect(screen.queryByText(/Minimum participants required/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Not Going$/ }));
    expect(screen.getByText(/non-refundable/)).toBeInTheDocument();
    expect(screen.getByText(/replacement/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm Not Going" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("submit_rsvp", expect.objectContaining({ response: "not_coming", expectedVersion: 2 })));
  });

  it("keeps cancelled events unavailable for RSVP changes", async () => {
    renderPage({ ...tripData, eventStatus: "cancelled" }, false);
    await screen.findByText("December Camping");
    expect(screen.queryByRole("button", { name: /^Not Going$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Going$/ })).not.toBeInTheDocument();
  });

  it("does not show the 30-day warning outside its notice window", async () => {
    const user = userEvent.setup();
    const start = new Date(); start.setDate(start.getDate() + 32);
    renderPage({ ...tripData, startsOn: start.toISOString().slice(0, 10),
      myRsvp: { response: "coming", version: 2, acknowledgmentId: "ack-1", updatedAt: "2026-10-14T00:00:00Z" } }, false);
    await screen.findByText("December Camping");
    await user.click(screen.getByRole("button", { name: /^Not Going$/ }));
    expect(screen.queryByText(/You are withdrawing within 30 days/)).not.toBeInTheDocument();
  });

  it("does not force more duties when the daily slots are all taken", async () => {
    renderPage({ ...tripData,
      myRsvp: { response: "coming", version: 1, acknowledgmentId: "ack-1", updatedAt: "2026-10-14T00:00:00Z" },
      myDailyWorkload: { target: 4, tripVersion: 1, satisfied: true, days: [
        { date: "2026-12-05", selectedWeight: 0, totalWeight: 8, remainingWeight: 0, eligibleSlots: 0, status: "no_tasks_available" },
      ] },
    }, false);
    await screen.findByText("December Camping");
    expect(screen.queryByText(/Action Needed:/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Daily workload: no additional selections needed/ })).toBeInTheDocument();
  });

  it("allows Accountant to see and click Verify Deposit in attendee roster", async () => {
    const user = userEvent.setup();
    const tripWithSubmissions = {
      ...tripData,
      participantEntries: [
        { memberId: "m1", displayName: "Alice", response: "coming", depositStatus: "submitted_by_member" },
        { memberId: "m2", displayName: "Bob", response: "coming", depositStatus: "unpaid" },
        { memberId: "m3", displayName: "Charlie", response: "coming", depositStatus: "confirmed" },
      ],
    };
    const apiMock = vi.fn().mockImplementation((action: string) => {
      if (action === "get_trip_details") return Promise.resolve(tripWithSubmissions);
      if (action === "verify_deposit") return Promise.resolve({ success: true });
      if (action === "get_constitution") return Promise.resolve({ definitions: [] });
      if (action === "get_trip_task_matrix") return Promise.resolve({ timeSlots: [], activeAssignments: [], driverCredits: [], myQuotaProgress: null, confirmedAttendees: [] });
      if (action === "get_trip_financials") return Promise.resolve({ expenses: [], carpoolReimbursements: [], cabinDeposit: null, settlementRun: null, balances: [], transfers: [], isFinalized: false });
      return Promise.resolve({});
    });

    renderPage(tripWithSubmissions, false, apiMock, "/trips/trip-1", "accountant", "m-accountant");

    await screen.findByText("December Camping");
    expect(await screen.findByText("Alice")).toBeInTheDocument();

    const aliceChip = screen.getByText("Alice").closest(".attendee-chip")!;
    const verifyBtn = within(aliceChip as HTMLElement).getByRole("button", { name: /verify deposit/i });
    expect(verifyBtn).toBeInTheDocument();

    await user.click(verifyBtn);

    expect(apiMock).toHaveBeenCalledWith("verify_deposit", {
      tripId: "trip-1",
      memberId: "m1",
      status: "confirmed_by_admin",
    });
  });

  it("hides Verify Deposit button for standard Member", async () => {
    const tripWithSubmissions = {
      ...tripData,
      participantEntries: [
        { memberId: "m1", displayName: "Alice", response: "coming", depositStatus: "submitted_by_member" },
      ],
    };

    renderPage(tripWithSubmissions, false, undefined, "/trips/trip-1", "member", "m-member");

    await screen.findByText("December Camping");
    expect(await screen.findByText("Alice")).toBeInTheDocument();

    expect(screen.queryByRole("button", { name: /verify deposit/i })).not.toBeInTheDocument();
  });

  it("prevents Accountant from seeing admin management controls", async () => {
    const tripWithSubmissions = {
      ...tripData,
      allMemberEntries: [
        { memberId: "m1", displayName: "Alice", response: "coming", version: 1 },
      ],
      waitlistEntries: [
        { memberId: "m4", displayName: "David", position: 1, createdAt: "2026-10-02T10:00:00Z" },
      ],
    };

    renderPage(tripWithSubmissions, false, undefined, "/trips/trip-1", "accountant", "m-accountant");

    await screen.findByText("December Camping");

    // Must NOT see "Edit Trip" button
    expect(screen.queryByRole("button", { name: /edit trip/i })).not.toBeInTheDocument();

    // Must NOT see "Admin: Manage Attendee Roster" box
    expect(screen.queryByText(/admin: manage attendee roster/i)).not.toBeInTheDocument();

    // Must NOT see "Manage Meals & Chores" button
    expect(screen.queryByRole("button", { name: /manage meals & chores/i })).not.toBeInTheDocument();
  });

  describe("5-Item Readiness Scorecard with Activity Participation", () => {
    const readyTripData = {
      ...tripData,
      depositStatus: "confirmed" as const,
      myRsvp: {
        response: "coming" as const,
        version: 1,
        acknowledgmentId: "ack-1",
        updatedAt: "2026-10-14T00:00:00Z",
      },
      myDailyWorkload: {
        target: 2,
        tripVersion: 1,
        satisfied: true,
        days: [
          {
            date: "2026-12-05",
            selectedWeight: 2,
            totalWeight: 2,
            remainingWeight: 0,
            eligibleSlots: 0,
            status: "target_met" as const,
          },
        ],
      },
    };

    const scheduledActivity = {
      id: "act-1",
      trip_id: "trip-1",
      title: "Monterey GoCar Tour",
      activity_date: "2026-12-06",
      start_time: "10:00",
      participants: [] as Array<{
        id: string;
        activity_id: string;
        member_id: string;
        status: "attending" | "opted_out";
      }>,
      groups: [],
      swap_requests: [],
    };

    it("displays 5 items when an activity is scheduled for the trip, with 4 of 5 Completed when unanswered", async () => {
      const apiMock = vi.fn().mockImplementation((action: string) => {
        if (action === "get_trip_details") return Promise.resolve(readyTripData);
        if (action === "get_trip_activities") return Promise.resolve({ tripId: "trip-1", activities: [scheduledActivity] });
        if (action === "get_constitution") return Promise.resolve({ definitions: [] });
        if (action === "get_trip_task_matrix") return Promise.resolve({ timeSlots: [], activeAssignments: [], driverCredits: [], myQuotaProgress: null, confirmedAttendees: [] });
        if (action === "get_trip_financials") return Promise.resolve({ expenses: [], carpoolReimbursements: [], cabinDeposit: null, settlementRun: null, balances: [], transfers: [], isFinalized: false });
        return Promise.resolve({});
      });

      renderPage(readyTripData, false, apiMock, "/trips/trip-1", "member", "m1");

      await screen.findByText("December Camping");
      expect(await screen.findByText(/⚡ Required From You \(4 of 5 Completed\)/i)).toBeInTheDocument();
      expect(screen.getByTestId("hub-activity-row")).toBeInTheDocument();
      expect(screen.getByText(/Signature Activity/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /count me in/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /opt out/i })).toBeInTheDocument();
    });

    it("clicking Count Me In! invokes set_activity_participation with status: 'attending' and updates to 5 of 5 Completed (All Done ✓)", async () => {
      const user = userEvent.setup();
      let activityParticipants: Array<{
        id: string;
        activity_id: string;
        member_id: string;
        status: "attending" | "opted_out";
      }> = [];

      const apiMock = vi.fn().mockImplementation((action: string, input?: any) => {
        if (action === "get_trip_details") return Promise.resolve(readyTripData);
        if (action === "get_trip_activities") {
          return Promise.resolve({
            tripId: "trip-1",
            activities: [{ ...scheduledActivity, participants: [...activityParticipants] }],
          });
        }
        if (action === "set_activity_participation") {
          activityParticipants = [
            { id: "p-1", activity_id: input.activityId, member_id: "m1", status: input.status },
          ];
          return Promise.resolve({ success: true });
        }
        if (action === "get_constitution") return Promise.resolve({ definitions: [] });
        if (action === "get_trip_task_matrix") return Promise.resolve({ timeSlots: [], activeAssignments: [], driverCredits: [], myQuotaProgress: null, confirmedAttendees: [] });
        if (action === "get_trip_financials") return Promise.resolve({ expenses: [], carpoolReimbursements: [], cabinDeposit: null, settlementRun: null, balances: [], transfers: [], isFinalized: false });
        return Promise.resolve({});
      });

      renderPage(readyTripData, false, apiMock, "/trips/trip-1", "member", "m1");

      await screen.findByText("December Camping");
      expect(await screen.findByText(/⚡ Required From You \(4 of 5 Completed\)/i)).toBeInTheDocument();

      const countMeInBtn = screen.getByRole("button", { name: /count me in/i });
      await user.click(countMeInBtn);

      expect(apiMock).toHaveBeenCalledWith(
        "set_activity_participation",
        expect.objectContaining({
          activityId: "act-1",
          status: "attending",
        })
      );

      expect(await screen.findByText(/⚡ Required From You \(5 of 5 Completed\)/i)).toBeInTheDocument();
      expect(screen.getByText("All Done ✓")).toBeInTheDocument();
      expect(screen.getByText(/Participating in Monterey GoCar Tour/i)).toBeInTheDocument();
    });

    it("clicking Opt Out invokes set_activity_participation with status: 'opted_out' and updates to 5 of 5 Completed", async () => {
      const user = userEvent.setup();
      let activityParticipants: Array<{
        id: string;
        activity_id: string;
        member_id: string;
        status: "attending" | "opted_out";
      }> = [];

      const apiMock = vi.fn().mockImplementation((action: string, input?: any) => {
        if (action === "get_trip_details") return Promise.resolve(readyTripData);
        if (action === "get_trip_activities") {
          return Promise.resolve({
            tripId: "trip-1",
            activities: [{ ...scheduledActivity, participants: [...activityParticipants] }],
          });
        }
        if (action === "set_activity_participation") {
          activityParticipants = [
            { id: "p-1", activity_id: input.activityId, member_id: "m1", status: input.status },
          ];
          return Promise.resolve({ success: true });
        }
        if (action === "get_constitution") return Promise.resolve({ definitions: [] });
        if (action === "get_trip_task_matrix") return Promise.resolve({ timeSlots: [], activeAssignments: [], driverCredits: [], myQuotaProgress: null, confirmedAttendees: [] });
        if (action === "get_trip_financials") return Promise.resolve({ expenses: [], carpoolReimbursements: [], cabinDeposit: null, settlementRun: null, balances: [], transfers: [], isFinalized: false });
        return Promise.resolve({});
      });

      renderPage(readyTripData, false, apiMock, "/trips/trip-1", "member", "m1");

      await screen.findByText("December Camping");
      expect(await screen.findByText(/⚡ Required From You \(4 of 5 Completed\)/i)).toBeInTheDocument();

      const optOutBtn = screen.getByRole("button", { name: /opt out/i });
      await user.click(optOutBtn);

      expect(apiMock).toHaveBeenCalledWith(
        "set_activity_participation",
        expect.objectContaining({
          activityId: "act-1",
          status: "opted_out",
        })
      );

      expect(await screen.findByText(/⚡ Required From You \(5 of 5 Completed\)/i)).toBeInTheDocument();
      expect(screen.getByText("All Done ✓")).toBeInTheDocument();
      expect(screen.getByText(/Opted Out \(Stay at Camp\)/i)).toBeInTheDocument();
    });

    it("allows user to change choice when pairings are unlocked, but hides Change button when pairings are locked", async () => {
      const user = userEvent.setup();
      let activityParticipants: Array<{
        id: string;
        activity_id: string;
        member_id: string;
        status: "attending" | "opted_out";
      }> = [
        { id: "p-1", activity_id: "act-1", member_id: "m1", status: "attending" },
      ];

      const apiMock = vi.fn().mockImplementation((action: string, input?: any) => {
        if (action === "get_trip_details") return Promise.resolve(readyTripData);
        if (action === "get_trip_activities") {
          return Promise.resolve({
            tripId: "trip-1",
            activities: [{ ...scheduledActivity, is_pairings_locked: false, participants: [...activityParticipants] }],
          });
        }
        if (action === "set_activity_participation") {
          activityParticipants = [
            { id: "p-1", activity_id: input.activityId, member_id: "m1", status: input.status },
          ];
          return Promise.resolve({ success: true });
        }
        if (action === "get_constitution") return Promise.resolve({ definitions: [] });
        if (action === "get_trip_task_matrix") return Promise.resolve({ timeSlots: [], activeAssignments: [], driverCredits: [], myQuotaProgress: null, confirmedAttendees: [] });
        if (action === "get_trip_financials") return Promise.resolve({ expenses: [], carpoolReimbursements: [], cabinDeposit: null, settlementRun: null, balances: [], transfers: [], isFinalized: false });
        return Promise.resolve({});
      });

      const { unmount } = renderPage(readyTripData, false, apiMock, "/trips/trip-1", "member", "m1");

      await screen.findByText("December Camping");
      expect(await screen.findByText(/⚡ Required From You \(5 of 5 Completed\)/i)).toBeInTheDocument();
      expect(screen.getByText(/Participating in Monterey GoCar Tour/i)).toBeInTheDocument();

      const activityRow = screen.getByTestId("hub-activity-row");
      const changeBtn = within(activityRow).getByRole("button", { name: "Change" });
      expect(changeBtn).toBeInTheDocument();
      await user.click(changeBtn);

      const optOutBtn = within(activityRow).getByRole("button", { name: /opt out/i });
      expect(optOutBtn).toBeInTheDocument();
      await user.click(optOutBtn);

      expect(apiMock).toHaveBeenCalledWith(
        "set_activity_participation",
        expect.objectContaining({
          activityId: "act-1",
          status: "opted_out",
        })
      );
      expect(await screen.findByText(/Opted Out \(Stay at Camp\)/i)).toBeInTheDocument();

      unmount();

      // Now verify that when pairings are locked, Change button is hidden
      const lockedApiMock = vi.fn().mockImplementation((action: string) => {
        if (action === "get_trip_details") return Promise.resolve(readyTripData);
        if (action === "get_trip_activities") {
          return Promise.resolve({
            tripId: "trip-1",
            activities: [{ ...scheduledActivity, is_pairings_locked: true, participants: [...activityParticipants] }],
          });
        }
        if (action === "get_constitution") return Promise.resolve({ definitions: [] });
        if (action === "get_trip_task_matrix") return Promise.resolve({ timeSlots: [], activeAssignments: [], driverCredits: [], myQuotaProgress: null, confirmedAttendees: [] });
        if (action === "get_trip_financials") return Promise.resolve({ expenses: [], carpoolReimbursements: [], cabinDeposit: null, settlementRun: null, balances: [], transfers: [], isFinalized: false });
        return Promise.resolve({});
      });

      renderPage(readyTripData, false, lockedApiMock, "/trips/trip-1", "member", "m1");
      await screen.findByText("December Camping");
      expect(await screen.findByText(/⚡ Required From You \(5 of 5 Completed\)/i)).toBeInTheDocument();
      const lockedActivityRow = screen.getByTestId("hub-activity-row");
      expect(within(lockedActivityRow).queryByRole("button", { name: "Change" })).not.toBeInTheDocument();
    });

    it("Item #5 in scorecard has a clickable activity link that switches tab to activities", async () => {
      const user = userEvent.setup();
      const apiMock = vi.fn().mockImplementation((action: string) => {
        if (action === "get_trip_details") return Promise.resolve(readyTripData);
        if (action === "get_trip_activities") return Promise.resolve({ tripId: "trip-1", activities: [scheduledActivity] });
        if (action === "get_constitution") return Promise.resolve({ definitions: [] });
        if (action === "get_trip_task_matrix") return Promise.resolve({ timeSlots: [], activeAssignments: [], driverCredits: [], myQuotaProgress: null, confirmedAttendees: [] });
        if (action === "get_trip_financials") return Promise.resolve({ expenses: [], carpoolReimbursements: [], cabinDeposit: null, settlementRun: null, balances: [], transfers: [], isFinalized: false });
        return Promise.resolve({});
      });

      renderPage(readyTripData, false, apiMock, "/trips/trip-1", "member", "m1");
      await screen.findByText("December Camping");

      const activityRow = screen.getByTestId("hub-activity-row");
      const activityBtn = within(activityRow).getByRole("button", { name: /signature activity/i });
      expect(activityBtn).toBeInTheDocument();
      expect(activityBtn).toHaveClass("hub-activity-row-btn");
      expect(activityBtn).toHaveStyle({ color: "#1f2937" });

      await user.click(activityBtn);

      expect(screen.getByRole("tab", { name: /activities/i })).toHaveAttribute("aria-selected", "true");
    });

    it("renders Compact Activity Card on overview tab with thumbnail, title, schedule, address, and booking link", async () => {
      const detailedActivity = {
        id: "act-1",
        trip_id: "trip-1",
        title: "Monterey GoCar Tour",
        category: "tour",
        image_url: "https://images.unsplash.com/photo-1544620347-c4fd4a3d5957",
        location_name: "GoCar Monterey Tours",
        address: "700 Cannery Row, Monterey, CA 93940",
        directions_url: "https://maps.google.com/?q=700+Cannery+Row+Monterey",
        booking_url: "https://www.groupon.com/deals/gocar-tours-monterey",
        activity_date: "2026-09-12",
        start_time: "10:00",
        end_time: "17:00",
        unit_label: "GoCar",
        unit_capacity: 2,
        participants: [],
        groups: [],
        swap_requests: [],
      };

      const apiMock = vi.fn().mockImplementation((action: string) => {
        if (action === "get_trip_details") return Promise.resolve(readyTripData);
        if (action === "get_trip_activities") return Promise.resolve({ tripId: "trip-1", activities: [detailedActivity] });
        if (action === "get_constitution") return Promise.resolve({ definitions: [] });
        if (action === "get_trip_task_matrix") return Promise.resolve({ timeSlots: [], activeAssignments: [], driverCredits: [], myQuotaProgress: null, confirmedAttendees: [] });
        if (action === "get_trip_financials") return Promise.resolve({ expenses: [], carpoolReimbursements: [], cabinDeposit: null, settlementRun: null, balances: [], transfers: [], isFinalized: false });
        return Promise.resolve({});
      });

      renderPage(readyTripData, false, apiMock, "/trips/trip-1", "member", "m1");
      await screen.findByText("December Camping");

      const overviewCard = screen.getByTestId("hub-activity-overview-card");
      expect(overviewCard).toBeInTheDocument();

      // Thumbnail image
      const thumbnailImg = within(overviewCard).getByRole("img", { name: "Monterey GoCar Tour" });
      expect(thumbnailImg).toHaveAttribute("src", "https://images.unsplash.com/photo-1544620347-c4fd4a3d5957");

      // Title button
      expect(within(overviewCard).getByRole("button", { name: "Monterey GoCar Tour" })).toBeInTheDocument();

      // Category badge
      expect(within(overviewCard).getByText(/🎯 Tour \(2 per GoCar\)/i)).toBeInTheDocument();

      // Schedule
      expect(within(overviewCard).getByText(/📅 Saturday, Sep 12 • 10:00 AM – 5:00 PM/i)).toBeInTheDocument();

      // Location
      expect(within(overviewCard).getByText(/📍 GoCar Monterey Tours • 700 Cannery Row, Monterey, CA 93940/i)).toBeInTheDocument();

      // Booking link
      const bookingLink = within(overviewCard).getByRole("link", { name: /Buy on Groupon \/ Booking Link/i });
      expect(bookingLink).toHaveAttribute("href", "https://www.groupon.com/deals/gocar-tours-monterey");
      expect(bookingLink).toHaveAttribute("target", "_blank");
      expect(bookingLink).toHaveClass("btn-sm-accent");

      // Directions link
      const directionsLink = within(overviewCard).getByRole("link", { name: /Directions/i });
      expect(directionsLink).toHaveAttribute("href", "https://maps.google.com/?q=700+Cannery+Row+Monterey");
      expect(directionsLink).toHaveAttribute("target", "_blank");
      expect(directionsLink).toHaveClass("btn-sm-secondary");
    });

    it("clicking View Activity & Pairings → on the compact card switches tab to activities", async () => {
      const user = userEvent.setup();
      const apiMock = vi.fn().mockImplementation((action: string) => {
        if (action === "get_trip_details") return Promise.resolve(readyTripData);
        if (action === "get_trip_activities") return Promise.resolve({ tripId: "trip-1", activities: [scheduledActivity] });
        if (action === "get_constitution") return Promise.resolve({ definitions: [] });
        if (action === "get_trip_task_matrix") return Promise.resolve({ timeSlots: [], activeAssignments: [], driverCredits: [], myQuotaProgress: null, confirmedAttendees: [] });
        if (action === "get_trip_financials") return Promise.resolve({ expenses: [], carpoolReimbursements: [], cabinDeposit: null, settlementRun: null, balances: [], transfers: [], isFinalized: false });
        return Promise.resolve({});
      });

      renderPage(readyTripData, false, apiMock, "/trips/trip-1", "member", "m1");
      await screen.findByText("December Camping");

      const overviewCard = screen.getByTestId("hub-activity-overview-card");
      const viewPairingsBtn = within(overviewCard).getByRole("button", { name: /View Activity & Pairings →/i });
      expect(viewPairingsBtn).toBeInTheDocument();
      expect(viewPairingsBtn).toHaveClass("btn-sm-primary");

      await user.click(viewPairingsBtn);

      expect(screen.getByRole("tab", { name: /activities/i })).toHaveAttribute("aria-selected", "true");
    });

    it("clicking the activity title on the compact card switches tab to activities", async () => {
      const user = userEvent.setup();
      const apiMock = vi.fn().mockImplementation((action: string) => {
        if (action === "get_trip_details") return Promise.resolve(readyTripData);
        if (action === "get_trip_activities") return Promise.resolve({ tripId: "trip-1", activities: [scheduledActivity] });
        if (action === "get_constitution") return Promise.resolve({ definitions: [] });
        if (action === "get_trip_task_matrix") return Promise.resolve({ timeSlots: [], activeAssignments: [], driverCredits: [], myQuotaProgress: null, confirmedAttendees: [] });
        if (action === "get_trip_financials") return Promise.resolve({ expenses: [], carpoolReimbursements: [], cabinDeposit: null, settlementRun: null, balances: [], transfers: [], isFinalized: false });
        return Promise.resolve({});
      });

      renderPage(readyTripData, false, apiMock, "/trips/trip-1", "member", "m1");
      await screen.findByText("December Camping");

      const overviewCard = screen.getByTestId("hub-activity-overview-card");
      const titleBtn = within(overviewCard).getByRole("button", { name: "Monterey GoCar Tour" });
      await user.click(titleBtn);

      expect(screen.getByRole("tab", { name: /activities/i })).toHaveAttribute("aria-selected", "true");
    });

    it("renders fallback placeholder on compact card when image fails or is missing", async () => {
      const noImageActivity = {
        ...scheduledActivity,
        image_url: null,
      };

      const apiMock = vi.fn().mockImplementation((action: string) => {
        if (action === "get_trip_details") return Promise.resolve(readyTripData);
        if (action === "get_trip_activities") return Promise.resolve({ tripId: "trip-1", activities: [noImageActivity] });
        if (action === "get_constitution") return Promise.resolve({ definitions: [] });
        if (action === "get_trip_task_matrix") return Promise.resolve({ timeSlots: [], activeAssignments: [], driverCredits: [], myQuotaProgress: null, confirmedAttendees: [] });
        if (action === "get_trip_financials") return Promise.resolve({ expenses: [], carpoolReimbursements: [], cabinDeposit: null, settlementRun: null, balances: [], transfers: [], isFinalized: false });
        return Promise.resolve({});
      });

      renderPage(readyTripData, false, apiMock, "/trips/trip-1", "member", "m1");
      await screen.findByText("December Camping");

      const overviewCard = screen.getByTestId("hub-activity-overview-card");
      expect(within(overviewCard).getByLabelText("Activity category icon")).toBeInTheDocument();
      expect(within(overviewCard).queryByRole("img")).not.toBeInTheDocument();
    });

    it("renders booking link from booking_notes when booking_url is null and booking_notes is a URL", async () => {
      const notesUrlActivity = {
        ...scheduledActivity,
        booking_url: null,
        booking_notes: "https://www.groupon.com/deals/gocar-tours-from-notes",
      };

      const apiMock = vi.fn().mockImplementation((action: string) => {
        if (action === "get_trip_details") return Promise.resolve(readyTripData);
        if (action === "get_trip_activities") return Promise.resolve({ tripId: "trip-1", activities: [notesUrlActivity] });
        if (action === "get_constitution") return Promise.resolve({ definitions: [] });
        if (action === "get_trip_task_matrix") return Promise.resolve({ timeSlots: [], activeAssignments: [], driverCredits: [], myQuotaProgress: null, confirmedAttendees: [] });
        if (action === "get_trip_financials") return Promise.resolve({ expenses: [], carpoolReimbursements: [], cabinDeposit: null, settlementRun: null, balances: [], transfers: [], isFinalized: false });
        return Promise.resolve({});
      });

      renderPage(readyTripData, false, apiMock, "/trips/trip-1", "member", "m1");
      await screen.findByText("December Camping");

      const overviewCard = screen.getByTestId("hub-activity-overview-card");
      const bookingLink = within(overviewCard).getByRole("link", { name: /Buy on Groupon \/ Booking Link/i });
      expect(bookingLink).toHaveAttribute("href", "https://www.groupon.com/deals/gocar-tours-from-notes");
    });

    it("displays green checkmark for deposit row when status is submitted_by_member", async () => {
      const tripWithSubmittedDeposit = {
        ...readyTripData,
        depositStatus: "submitted_by_member" as const,
        cabinPayerMemberId: null,
      };

      const apiMock = vi.fn().mockImplementation((action: string) => {
        if (action === "get_trip_details") return Promise.resolve(tripWithSubmittedDeposit);
        if (action === "get_trip_activities") return Promise.resolve({ tripId: "trip-1", activities: [] });
        if (action === "get_constitution") return Promise.resolve({ definitions: [] });
        if (action === "get_trip_task_matrix") return Promise.resolve({ timeSlots: [], activeAssignments: [], driverCredits: [], myQuotaProgress: null, confirmedAttendees: [] });
        if (action === "get_trip_financials") return Promise.resolve({ expenses: [], carpoolReimbursements: [], cabinDeposit: null, settlementRun: null, balances: [], transfers: [], isFinalized: false });
        return Promise.resolve({});
      });

      renderPage(tripWithSubmittedDeposit, false, apiMock, "/trips/trip-1", "member", "m1");
      await screen.findByText("December Camping");

      const depositRow = screen.getByTestId("hub-deposit-row");
      expect(within(depositRow).getByText("✓")).toBeInTheDocument();
      expect(within(depositRow).getByText(/Submitted \(Pending Verification\)/i)).toBeInTheDocument();
      expect(within(depositRow).getByText("Submitted ✓")).toBeInTheDocument();
    });

    it("displays waiver required warning and sign button when attending with unsigned waiver, and displays checkmark when signed", async () => {
      const waiverActivity = {
        ...scheduledActivity,
        waiver_url: "https://fareharbor.com/waivers?shortname=seacartours",
        participants: [
          {
            id: "p-1",
            activity_id: "act-1",
            member_id: "m1",
            status: "attending" as const,
            waiver_clicked_at: "2026-10-24T12:00:00Z",
            waiver_signed_at: null,
          },
        ],
      };

      const apiMock = vi.fn().mockImplementation((action: string) => {
        if (action === "get_trip_details") return Promise.resolve(readyTripData);
        if (action === "get_trip_activities") return Promise.resolve({ tripId: "trip-1", activities: [waiverActivity] });
        if (action === "get_constitution") return Promise.resolve({ definitions: [] });
        if (action === "get_trip_task_matrix") return Promise.resolve({ timeSlots: [], activeAssignments: [], driverCredits: [], myQuotaProgress: null, confirmedAttendees: [] });
        if (action === "get_trip_financials") return Promise.resolve({ expenses: [], carpoolReimbursements: [], cabinDeposit: null, settlementRun: null, balances: [], transfers: [], isFinalized: false });
        return Promise.resolve({});
      });

      const { unmount } = renderPage(readyTripData, false, apiMock, "/trips/trip-1", "member", "m1");
      await screen.findByText("December Camping");

      const activityRow = screen.getByTestId("hub-activity-row");
      expect(within(activityRow).getByText(/📝 Waiver Required/i)).toBeInTheDocument();
      expect(within(activityRow).getByText("Waiver Pending ⚠️")).toBeInTheDocument();
      expect(within(activityRow).getByRole("button", { name: /Sign Waiver →/i })).toBeInTheDocument();

      unmount();

      // When waiver is signed
      const signedWaiverActivity = {
        ...waiverActivity,
        participants: [
          {
            ...waiverActivity.participants[0],
            waiver_signed_at: "2026-10-24T12:30:00Z",
          },
        ],
      };

      const signedApiMock = vi.fn().mockImplementation((action: string) => {
        if (action === "get_trip_details") return Promise.resolve(readyTripData);
        if (action === "get_trip_activities") return Promise.resolve({ tripId: "trip-1", activities: [signedWaiverActivity] });
        if (action === "get_constitution") return Promise.resolve({ definitions: [] });
        if (action === "get_trip_task_matrix") return Promise.resolve({ timeSlots: [], activeAssignments: [], driverCredits: [], myQuotaProgress: null, confirmedAttendees: [] });
        if (action === "get_trip_financials") return Promise.resolve({ expenses: [], carpoolReimbursements: [], cabinDeposit: null, settlementRun: null, balances: [], transfers: [], isFinalized: false });
        return Promise.resolve({});
      });

      renderPage(readyTripData, false, signedApiMock, "/trips/trip-1", "member", "m1");
      await screen.findByText("December Camping");

      const signedActivityRow = screen.getByTestId("hub-activity-row");
      expect(within(signedActivityRow).getByText(/✓ Waiver Signed/i)).toBeInTheDocument();
      expect(within(signedActivityRow).getByText("Attending ✓")).toBeInTheDocument();
    });
  });
});

