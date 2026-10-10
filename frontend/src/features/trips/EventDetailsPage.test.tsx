import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { EventDetailsPage } from "./EventDetailsPage";
import { TripApiError } from "../../lib/supabase";

const tripData = {
  tripId: "trip-1",
  monthKey: "2026-12",
  pollStatus: "open" as const,
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
    return Promise.resolve({});
  })
) {
  const result = render(
    <MemoryRouter initialEntries={["/trips/trip-1"]}>
      <Routes>
        <Route path="/trips/:tripId" element={<EventDetailsPage isAdmin={isAdmin} api={apiMock} />} />
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

  it("switches to Financials tab and displays settlement placeholder", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("December Camping");

    await user.click(screen.getByRole("tab", { name: /financials/i }));
    expect(screen.getByRole("heading", { name: /financials/i })).toBeInTheDocument();
    expect(
      screen.getByText(/settlement details will be available after the trip is confirmed/i)
    ).toBeInTheDocument();
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
    expect(await screen.findByText("3 Going")).toBeInTheDocument();
    expect(screen.queryByText(/waitlist \(1\)/i)).not.toBeInTheDocument();
    unmount();

    // Admin view
    renderPage(tripData, true);
    expect(await screen.findByText("3 Going")).toBeInTheDocument();
    expect(screen.getByText(/waitlist \(1\)/i)).toBeInTheDocument();
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
});

