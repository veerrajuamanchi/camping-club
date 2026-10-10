import { fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { TripApiError } from "../../lib/supabase";
import { TripCalendarPage, type Calendar, type TripApi } from "./TripCalendarPage";

import type { ReactElement } from "react";
import type { RenderOptions } from "@testing-library/react";

const render = (ui: ReactElement, options?: Omit<RenderOptions, "wrapper">) =>
  rtlRender(ui, { wrapper: MemoryRouter, ...options });

export const makeCalendar = (): Calendar => ({
  clubConfiguration: { timezone: "America/Los_Angeles", defaultPollLeadDays: 35, defaultPollCloseTime: "18:00:00", defaultMinimumParticipants: 4, nextMonthToGenerate: "2027-01-01", nextRotationPosition: 1, version: 2 },
  campsites: [{ campsiteId: "site-1", rotationPosition: 1, name: "Del Monte", availabilityUrl: "https://example.test", locationDescription: "North", directions: null, cabinCapacity: 8, cabinTypes: ["cabin"], reservationInstructions: null, estimatedRateCents: 25000, availabilityStatus: "unknown", availabilitySourceUrl: null, availabilityVerifiedAt: null, version: 1 }],
  trips: [{ tripId: "trip-1", monthKey: "2027-01", rotationPosition: 1, suggestedCampsiteId: "site-1", selectedCampsiteId: "site-1", startsOn: "2027-01-15", endsOn: "2027-01-17", clubTimezone: "America/Los_Angeles", pollDeadlineAt: "2027-01-01T18:00:00-08:00", minimumParticipants: 4, minimumBasis: null, maxCapacity: 8, perCabinCapacity: 6, cabinCount: null, effectiveCapacity: 8, spotsRemaining: 6, waitlistCount: 0, myWaitlistPosition: null, pollStatus: "open", additionalInformation: "Bring warm clothes", cabinBookingStatus: "booked", version: 3, comingCount: 2, tripDecision: "none", currentRuleBundle: { id: "bundle-1", version: 1, contentHash: "a".repeat(64), rules: [{ stable_key: "disclosure", text: "Coming is an interest response only.", structured_values: {} }], createdAt: "2026-10-01T00:00:00Z" }, myRsvp: null }],
});

const buildCalendar = (tripOverrides: Partial<Calendar["trips"][number]>[] = []): Calendar => {
  const base = makeCalendar();
  if (tripOverrides.length > 0) {
    base.trips = tripOverrides.map((override, i) => ({
      ...base.trips[0],
      tripId: `trip-${i + 1}`,
      ...override,
    }));
  }
  return base;
};

const mockApi = (calendar: Calendar): TripApi => {
  return vi.fn(async () => calendar) as unknown as TripApi;
};

describe("TripCalendarPage", () => {
  it("requires rule acknowledgment for Going and records the exact bundle", async () => {
    const api = vi.fn(async () => makeCalendar());
    render(<TripCalendarPage isAdmin={false} api={api as unknown as TripApi} />);
    await screen.findByText(/January 2027/);
    fireEvent.click(screen.getByRole("button", { name: "Going" }));
    expect(screen.getByText("Coming is an interest response only.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm Going" }));
    expect(await screen.findByText("Acknowledge the Camping Constitution before selecting Going.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /I have read and agree/i }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Going" }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("submit_rsvp", expect.objectContaining({
      tripId: "trip-1", response: "coming", bundleId: "bundle-1", contentHash: "a".repeat(64), expectedVersion: 0,
    })));
  });

  it("lets a member answer Not Coming without accepting the rules", async () => {
    const api = vi.fn(async () => makeCalendar());
    render(<TripCalendarPage isAdmin={false} api={api as unknown as TripApi} />);
    await screen.findByText(/January 2027/);
    fireEvent.click(screen.getByRole("button", { name: "Not Going" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Not Going" }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("submit_rsvp", expect.objectContaining({ tripId: "trip-1", response: "not_coming" })));
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("keeps management controls out of member view", async () => {
    const api = vi.fn(async () => makeCalendar());
    render(<TripCalendarPage isAdmin={false} api={api as unknown as TripApi} />);
    await screen.findByText(/January 2027/);
    expect(screen.queryByRole("button", { name: "+ Add Custom Camping" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "✏️ Edit" })).not.toBeInTheDocument();
  });

  it("opens + Add Custom Camping modal and saves custom trip", async () => {
    const calendar = makeCalendar();
    const api = vi.fn(async () => calendar);
    render(<TripCalendarPage isAdmin api={api as unknown as TripApi} />);
    await screen.findByText(/January 2027/);

    fireEvent.click(screen.getByRole("button", { name: "+ Add Custom Camping" }));
    expect(await screen.findByText("Add / Configure Custom Camping")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save Custom Camping" }));

    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        "admin_configure_trip",
        expect.objectContaining({
          tripId: "trip-1",
        })
      )
    );
  });

  it("opens ✏️ Edit modal on EventCard and submits trip configuration", async () => {
    const calendar = makeCalendar();
    const api = vi.fn(async () => calendar);
    render(<TripCalendarPage isAdmin api={api as unknown as TripApi} />);
    await screen.findByText(/January 2027/);

    fireEvent.click(screen.getByRole("button", { name: "✏️ Edit" }));
    expect(await screen.findByText(/Edit January 2027 Camping/)).toBeInTheDocument();

    const bookingStatus = screen.getByLabelText("Cabin booking status");
    fireEvent.change(bookingStatus, { target: { value: "booked" } });

    const cabinCountInput = screen.getByLabelText("Cabin count");
    fireEvent.change(cabinCountInput, { target: { value: "3" } });

    const perCabinInput = screen.getByLabelText("Per-cabin capacity");
    fireEvent.change(perCabinInput, { target: { value: "8" } });

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        "admin_configure_trip",
        expect.objectContaining({
          tripId: "trip-1",
          cabinBookingStatus: "booked",
          cabinCount: 3,
          perCabinCapacity: 8,
        })
      )
    );
  });

  it("shows ambiguous legacy availability to admins in edit modal", async () => {
    const calendar = makeCalendar();
    calendar.trips[0].cabinBookingStatus = null;
    calendar.trips[0].legacyCabinAvailabilityStatus = "limited";
    const api = vi.fn(async () => calendar);
    render(<TripCalendarPage isAdmin api={api as unknown as TripApi} />);
    await screen.findByText(/January 2027/);

    fireEvent.click(screen.getByRole("button", { name: "✏️ Edit" }));
    expect(
      await screen.findByText(
        "Previous availability value: limited. Choose a booking status; this older value was not converted automatically."
      )
    ).toBeInTheDocument();
  });

  it("explains when another administrator changed the trip before this save", async () => {
    const calendar = makeCalendar();
    const api = vi.fn(async (action: string) => {
      if (action === "admin_configure_trip") throw new TripApiError("stale_record", 409);
      return calendar;
    });
    render(<TripCalendarPage isAdmin api={api as unknown as TripApi} />);
    await screen.findByText(/January 2027/);

    fireEvent.click(screen.getByRole("button", { name: "✏️ Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(
      await screen.findByText("This trip changed while you were editing. Refresh and try again.")
    ).toBeInTheDocument();
  });

  it("preserves the exact older Constitution version for an existing Coming response", async () => {
    const calendar = makeCalendar();
    calendar.trips[0].currentRuleBundle = { ...calendar.trips[0].currentRuleBundle!, id: "bundle-2", version: 2, contentHash: "b".repeat(64), rules: [{ stable_key: "disclosure", text: "Updated current rule.", structured_values: {} }] };
    calendar.trips[0].myRsvp = { response: "coming", acknowledgmentId: "ack-1", version: 4, updatedAt: "2026-10-01T00:00:00Z", acceptedRuleBundle: { id: "bundle-1", version: 1, contentHash: "a".repeat(64), rules: [{ stable_key: "disclosure", text: "Original accepted rule.", structured_values: {} }], createdAt: "2026-09-01T00:00:00Z" } };
    const api = vi.fn(async () => calendar);
    render(<TripCalendarPage isAdmin={false} api={api as unknown as TripApi} />);
    await screen.findByText(/you accepted Constitution version 1/i);
    fireEvent.click(screen.getByText("View the exact rules version you accepted"));
    expect(screen.getByText("Original accepted rule.")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Going ✓" })).toBeInTheDocument();
  });

  it("records a post-deadline withdrawal request without changing Coming", async () => {
    const calendar = makeCalendar();
    calendar.trips[0].pollStatus = "closed";
    calendar.trips[0].pollDeadlineAt = "2026-10-01T18:00:00-07:00";
    calendar.trips[0].myRsvp = { response: "coming", acknowledgmentId: "ack-1", version: 4, updatedAt: "2026-10-01T00:00:00Z" };
    const api = vi.fn(async (action: string) => action === "request_withdrawal" ? { state: "pending_owner_policy" } : calendar);
    render(<TripCalendarPage isAdmin={false} api={api as unknown as TripApi} />);
    fireEvent.change(await screen.findByLabelText("Reason"), { target: { value: "I can no longer attend" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit withdrawal request" }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("request_withdrawal", { tripId: "trip-1", reason: "I can no longer attend" }));
    expect(await screen.findByText(/effective poll response remains Coming/i)).toBeInTheDocument();
  });

  it("shows Dates TBA for draft trips", async () => {
    const calendar = buildCalendar([{
      tripId: "t1", pollStatus: "draft", startsOn: null, endsOn: null,
      perCabinCapacity: 6, cabinCount: 2, effectiveCapacity: 12,
      spotsRemaining: 12, waitlistCount: 0, myWaitlistPosition: null,
      comingCount: 0, myRsvp: null,
    }]);
    render(<TripCalendarPage isAdmin={false} api={mockApi(calendar)} />);
    expect(await screen.findByText(/dates tba/i)).toBeTruthy();
  });

  it("shows spots remaining and waitlist count", async () => {
    const calendar = buildCalendar([{
      tripId: "t1", pollStatus: "open", startsOn: "2026-12-05", endsOn: "2026-12-07",
      perCabinCapacity: 6, cabinCount: 2, effectiveCapacity: 12,
      spotsRemaining: 8, waitlistCount: 3, myWaitlistPosition: null,
      comingCount: 4, myRsvp: null,
    }]);
    render(<TripCalendarPage isAdmin={false} api={mockApi(calendar)} />);
    expect(await screen.findByText(/8 spots remaining/i)).toBeInTheDocument();
    expect(screen.getByText(/3 on waitlist/i)).toBeInTheDocument();
  });

  it("displays correct RSVP status badge for going, not going, waitlisted, and no response", async () => {
    const calendar = buildCalendar([
      { tripId: "t1", startsOn: "2027-01-15", endsOn: "2027-01-17", myRsvp: { response: "coming", acknowledgmentId: "ack", version: 1, updatedAt: "" } },
      { tripId: "t2", startsOn: "2027-02-15", endsOn: "2027-02-17", myRsvp: { response: "not_coming", acknowledgmentId: null, version: 1, updatedAt: "" } },
      { tripId: "t3", startsOn: "2027-03-15", endsOn: "2027-03-17", myWaitlistPosition: 2, myRsvp: null },
      { tripId: "t4", startsOn: "2027-04-15", endsOn: "2027-04-17", myRsvp: null, myWaitlistPosition: null },
    ]);
    render(<TripCalendarPage isAdmin={false} api={mockApi(calendar)} />);
    const goingChip = await screen.findByText("Going", { selector: ".status-chip" });
    expect(goingChip).toHaveClass("status-coming");
    const notGoingChip = screen.getByText("Not Going", { selector: ".status-chip" });
    expect(notGoingChip).toHaveClass("status-not_coming");
    const waitlistedChip = screen.getByText("Waitlisted", { selector: ".status-chip" });
    expect(waitlistedChip).toHaveClass("status-waitlisted");
    const noResponseChip = screen.getByText("No response", { selector: ".status-chip" });
    expect(noResponseChip).toHaveClass("status-none");
  });

  it("renders trips in chronological order with drafts and null dates last", async () => {
    const calendar = buildCalendar([
      { tripId: "t1", monthKey: "2027-03", startsOn: "2027-03-10", endsOn: "2027-03-12", additionalInformation: "March Trip" },
      { tripId: "t2", monthKey: "2027-01", startsOn: "2027-01-15", endsOn: "2027-01-17", additionalInformation: "January Trip" },
      { tripId: "t3", monthKey: "2027-02", startsOn: null, endsOn: null, pollStatus: "draft", additionalInformation: "Draft Trip" },
    ]);
    render(<TripCalendarPage isAdmin={false} api={mockApi(calendar)} />);
    await screen.findByText("January Trip");
    const titles = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(titles).toEqual(["January Trip", "March Trip", "Draft Trip"]);
  });

  it("renders Going and Not Going buttons as disabled when poll is closed or past deadline", async () => {
    const calendar = buildCalendar([
      {
        tripId: "t1",
        pollStatus: "closed",
        startsOn: "2027-01-15",
        endsOn: "2027-01-17",
        additionalInformation: "Closed Trip",
      },
      {
        tripId: "t2",
        pollStatus: "open",
        pollDeadlineAt: "2026-01-01T18:00:00-08:00",
        startsOn: "2027-02-15",
        endsOn: "2027-02-17",
        additionalInformation: "Past Deadline Trip",
      },
    ]);
    render(<TripCalendarPage isAdmin={false} api={mockApi(calendar)} />);
    await screen.findByText("Closed Trip");

    const goingButtons = screen.getAllByRole("button", { name: "Going" });
    const notGoingButtons = screen.getAllByRole("button", { name: "Not Going" });
    expect(goingButtons).toHaveLength(2);
    expect(notGoingButtons).toHaveLength(2);

    expect(goingButtons[0]).toBeDisabled();
    expect(notGoingButtons[0]).toBeDisabled();
    expect(goingButtons[1]).toBeDisabled();
    expect(notGoingButtons[1]).toBeDisabled();

    expect(screen.getByText("This poll is closed.")).toBeInTheDocument();
    expect(screen.getByText("This poll has passed its deadline and is closing. You can contact an administrator.")).toBeInTheDocument();
  });

  it("shows Not Going button as selected when member already responded not coming", async () => {
    const calendar = buildCalendar([
      {
        tripId: "t1",
        pollStatus: "open",
        startsOn: "2027-01-15",
        endsOn: "2027-01-17",
        myRsvp: { response: "not_coming", acknowledgmentId: null, version: 1, updatedAt: "" },
      },
    ]);
    render(<TripCalendarPage isAdmin={false} api={mockApi(calendar)} />);
    await screen.findByText("Not Going", { selector: ".status-chip" });
    const notGoingButton = screen.getByRole("button", { name: "Not Going" });
    expect(notGoingButton).toHaveClass("selected");
  });

  it("sorts all draft trips after published/open/closed trips, with drafts sorted by monthKey or startsOn", async () => {
    const calendar = buildCalendar([
      { tripId: "t1", monthKey: "2027-04", startsOn: null, pollStatus: "draft", additionalInformation: "Draft April" },
      { tripId: "t2", monthKey: "2027-03", startsOn: "2027-03-10", endsOn: "2027-03-12", pollStatus: "open", additionalInformation: "March Open" },
      { tripId: "t3", monthKey: "2027-01", startsOn: "2027-01-15", endsOn: "2027-01-17", pollStatus: "closed", additionalInformation: "January Closed" },
      { tripId: "t4", monthKey: "2027-02", startsOn: "2027-02-20", endsOn: "2027-02-22", pollStatus: "draft", additionalInformation: "Draft February" },
    ]);
    render(<TripCalendarPage isAdmin={false} api={mockApi(calendar)} />);
    await screen.findByText("January Closed");
    const titles = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(titles).toEqual(["January Closed", "March Open", "Draft February", "Draft April"]);
  });

  it("displays waitlist feedback when submit_rsvp returns waitlisted", async () => {
    const calendar = makeCalendar();
    const api = vi.fn(async (action: string) => {
      if (action === "submit_rsvp") {
        return { waitlisted: true, position: 2 };
      }
      return calendar;
    });
    render(<TripCalendarPage isAdmin={false} api={api as unknown as TripApi} />);
    await screen.findByText(/January 2027/);
    fireEvent.click(screen.getByRole("button", { name: "Going" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /I have read and agree/i }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Going" }));

    expect(
      await screen.findByText("You are #2 on the waitlist. The administrator will notify you if a spot opens.")
    ).toBeInTheDocument();
  });
});

