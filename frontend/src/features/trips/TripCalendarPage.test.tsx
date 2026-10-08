import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TripCalendarPage, type Calendar, type TripApi } from "./TripCalendarPage";

const makeCalendar = (): Calendar => ({
  clubConfiguration: { timezone: "America/Los_Angeles", defaultPollLeadDays: 35, defaultPollCloseTime: "18:00:00", defaultMinimumParticipants: 4, nextMonthToGenerate: "2027-01-01", nextRotationPosition: 1, version: 2 },
  campsites: [{ campsiteId: "site-1", rotationPosition: 1, name: "Del Monte", availabilityUrl: "https://example.test", locationDescription: "North", directions: null, cabinCapacity: 8, cabinTypes: ["cabin"], reservationInstructions: null, estimatedRateCents: 25000, availabilityStatus: "unknown", availabilitySourceUrl: null, availabilityVerifiedAt: null, version: 1 }],
  trips: [{ tripId: "trip-1", monthKey: "2027-01", rotationPosition: 1, suggestedCampsiteId: "site-1", selectedCampsiteId: "site-1", startsOn: "2027-01-15", endsOn: "2027-01-17", clubTimezone: "America/Los_Angeles", pollDeadlineAt: "2027-01-01T18:00:00-08:00", minimumParticipants: 4, minimumBasis: null, maxCapacity: 8, pollStatus: "open", additionalInformation: "Bring warm clothes", cabinAvailabilityStatus: "unknown", version: 3, comingCount: 2, tripDecision: "none", currentRuleBundle: { id: "bundle-1", version: 1, contentHash: "a".repeat(64), rules: [{ stable_key: "disclosure", text: "Coming is an interest response only.", structured_values: {} }], createdAt: "2026-10-01T00:00:00Z" }, myRsvp: null }],
});

describe("TripCalendarPage", () => {
  it("requires rule acknowledgment for Coming and records the exact bundle", async () => {
    const api = vi.fn(async () => makeCalendar());
    render(<TripCalendarPage isAdmin={false} api={api as unknown as TripApi} />);
    await screen.findByText(/January 2027/);
    fireEvent.click(screen.getByRole("button", { name: "Coming" }));
    expect(screen.getByText("Coming is an interest response only.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Submit Coming response" }));
    expect(await screen.findByText("Acknowledge the current Camping Constitution before selecting Coming.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /I have read and agree/i }));
    fireEvent.click(screen.getByRole("button", { name: "Submit Coming response" }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("submit_rsvp", expect.objectContaining({
      tripId: "trip-1", response: "coming", bundleId: "bundle-1", contentHash: "a".repeat(64), expectedVersion: 0,
    })));
    expect(screen.getByText(/Interest only/)).toBeInTheDocument();
  });

  it("lets a member answer Not Coming without accepting the rules", async () => {
    const api = vi.fn(async () => makeCalendar());
    render(<TripCalendarPage isAdmin={false} api={api as unknown as TripApi} />);
    await screen.findByText(/January 2027/);
    fireEvent.click(screen.getByRole("button", { name: "Not Coming" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit Not Coming response" }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("submit_rsvp", expect.objectContaining({ tripId: "trip-1", response: "not_coming" })));
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("keeps management controls out of member view", async () => {
    const api = vi.fn(async () => makeCalendar());
    render(<TripCalendarPage isAdmin={false} api={api as unknown as TripApi} />);
    await screen.findByText(/January 2027/);
    expect(screen.queryByRole("tab", { name: "Campsites" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open poll" })).not.toBeInTheDocument();
  });

  it("shows the administrator schedule controls and saves the selected timezone", async () => {
    const api = vi.fn(async () => makeCalendar());
    render(<TripCalendarPage isAdmin api={api as unknown as TripApi} />);
    expect(await screen.findByText("Club schedule defaults")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Club timezone/), { target: { value: "America/Denver" } });
    fireEvent.click(screen.getByRole("button", { name: "Save club schedule defaults" }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("admin_configure_club", expect.objectContaining({ timezone: "America/Denver", defaultMinimumParticipants: 4, expectedVersion: 2 })));
  });

  it("shows and resaves an existing poll deadline in its club timezone", async () => {
    const calendar = makeCalendar();
    calendar.clubConfiguration.timezone = "America/Denver";
    calendar.trips[0].pollDeadlineAt = "2027-01-02T02:00:00Z";
    const api = vi.fn(async () => calendar);
    render(<TripCalendarPage isAdmin api={api as unknown as TripApi} />);
    await screen.findByRole("tab", { name: "Polls & calendar" });
    await screen.findByText("Monthly interest polls");
    expect(screen.getByLabelText("Registration deadline date")).toHaveValue("2027-01-01");
    expect(screen.getByLabelText("Deadline time in America/Los_Angeles")).toHaveValue("18:00");
    fireEvent.click(screen.getByRole("button", { name: "Save poll details" }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("admin_configure_trip", expect.objectContaining({
      tripId: "trip-1", deadlineDate: "2027-01-01", deadlineTime: "18:00",
    })));
  });

  it("lets an administrator update campsite details and restricted notes", async () => {
    const api = vi.fn(async () => makeCalendar());
    render(<TripCalendarPage isAdmin api={api as unknown as TripApi} />);
    fireEvent.click(await screen.findByRole("tab", { name: "Campsites" }));
    expect(await screen.findByText("Round-robin campsite order")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Location description"), { target: { value: "South shore" } });
    fireEvent.change(screen.getByLabelText("Estimated nightly rate ($)"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Administrator notes"), { target: { value: "Call the site office" } });
    const form = screen.getByRole("button", { name: "Save campsite details" }).closest("form");
    const invalidFields = Array.from(form?.elements ?? []).filter((field) => field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement).filter((field) => !field.validity.valid).map((field) => ({ label: field.labels?.[0]?.textContent, value: field.value, message: field.validationMessage }));
    expect(invalidFields, JSON.stringify(invalidFields)).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Save campsite details" }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("admin_update_campsite", expect.objectContaining({
      campsiteId: "site-1", expectedVersion: 1, locationDescription: "South shore", adminNotes: "Call the site office",
    })));
  });

  it("lets an administrator record a late interest response for a selected member", async () => {
    const calendar = makeCalendar();
    calendar.members = [{ memberId: "member-2", displayName: "Sam Member" }];
    const api = vi.fn(async () => calendar);
    render(<TripCalendarPage isAdmin api={api as unknown as TripApi} />);
    await screen.findByText("Record a late interest response");
    fireEvent.change(screen.getByLabelText("Member"), { target: { value: "member-2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save late response" }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("admin_record_interest", expect.objectContaining({
      tripId: "trip-1", memberId: "member-2", response: "coming", expectedVersion: 0,
    })));
  });

  it("lets an administrator publish an expiring override linked to a current general rule version", async () => {
    const calendar = makeCalendar();
    const constitution = {
      definitions: [{ id: "def-1", stable_key: "quiet-hours", category: "conduct", scope: "general", active: true }],
      versions: [{ id: "version-1", definition_id: "def-1", version_no: 2, human_text: "Use quiet hours.", effective_from: "2026-01-01T00:00:00Z", expires_at: null }],
      overrides: [], currentBundle: null, myAcknowledgments: [],
    };
    const api = vi.fn(async (action: string) => action === "get_calendar" ? calendar : constitution);
    render(<TripCalendarPage isAdmin api={api as unknown as TripApi} />);
    fireEvent.click(await screen.findByRole("tab", { name: "Constitution" }));
    fireEvent.change(await screen.findByLabelText("Applies to"), { target: { value: "trip" } });
    expect(await screen.findByText("Override a general rule for this trip")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("General rule to override"), { target: { value: "version-1" } });
    fireEvent.change(screen.getByLabelText("Trip-specific text"), { target: { value: "Use quiet hours as agreed by this trip." } });
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 16);
    fireEvent.change(screen.getByLabelText("Override expires at"), { target: { value: tomorrow } });
    fireEvent.change(screen.getByLabelText("Reason", { selector: "input" }), { target: { value: "Trip-specific agreement" } });
    fireEvent.click(screen.getByRole("button", { name: "Publish expiring override" }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("admin_set_rule_override", expect.objectContaining({
      tripId: "trip-1", baseRuleVersionId: "version-1", text: "Use quiet hours as agreed by this trip.",
    })));
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
    expect(screen.getByRole("button", { name: "Your response: Coming" })).toBeInTheDocument();
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
});
