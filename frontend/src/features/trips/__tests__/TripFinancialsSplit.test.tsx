import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  TripFinancialsTab,
  type TripFinancialsData,
} from "../TripFinancialsTab";

const mockFinancials: TripFinancialsData = {
  tripId: "trip-test-1",
  isFinalized: false,
  cabinDeposit: null,
  carpoolReimbursements: [],
  expenses: [],
  settlementRun: null,
  balances: [],
  transfers: [],
};

describe("Task 4: Frontend Expense Split UI Improvements", () => {
  it("renders full attendee names prominently in a vertical list with fallback to Camper", async () => {
    const user = userEvent.setup();
    const mockApi = vi.fn().mockImplementation((action: string) => {
      if (action === "get_trip_financials") {
        return Promise.resolve(mockFinancials);
      }
      return Promise.resolve({});
    });

    render(
      <TripFinancialsTab
        tripId="trip-test-1"
        isAdmin={true}
        isConfirmedAttendee={true}
        currentMemberId="m-1"
        confirmedAttendees={[
          { memberId: "m-1", displayName: "Alice Admin" },
          { memberId: "m-2", displayName: "Bob Camper" },
          { memberId: "m-3", displayName: "   " }, // Empty name -> fallback to "Camper"
        ]}
        api={mockApi}
      />
    );

    const addBtn = await screen.findByRole("button", { name: /\+ Add Shared Expense/i });
    await user.click(addBtn);

    expect(screen.getByText(/\+ Record Shared Expense/i)).toBeInTheDocument();

    // Verify the list container has data-testid and flex vertical column layout
    const splitList = screen.getByTestId("expense-split-list");
    expect(splitList).toHaveStyle({
      display: "flex",
      flexDirection: "column",
    });

    // Verify attendee names are prominently displayed with high contrast inside split list
    const aliceSpan = within(splitList).getByText(/Alice Admin \(You\)/i);
    expect(aliceSpan).toBeInTheDocument();
    expect(aliceSpan).toHaveStyle({ color: "#0f172a", fontWeight: 600 });

    const bobSpan = within(splitList).getByText(/Bob Camper/i);
    expect(bobSpan).toBeInTheDocument();
    expect(bobSpan).toHaveStyle({ color: "#0f172a", fontWeight: 600 });

    // Fallback to "Camper"
    const fallbackSpan = within(splitList).getByText(/^Camper$/i);
    expect(fallbackSpan).toBeInTheDocument();
    expect(fallbackSpan).toHaveStyle({ color: "#0f172a", fontWeight: 600 });
  });

  it("provides Select All and Clear shortcuts visible at once to update selection and live split counter", async () => {
    const user = userEvent.setup();
    const mockApi = vi.fn().mockImplementation((action: string) => {
      if (action === "get_trip_financials") {
        return Promise.resolve(mockFinancials);
      }
      return Promise.resolve({});
    });

    render(
      <TripFinancialsTab
        tripId="trip-test-1"
        isAdmin={true}
        isConfirmedAttendee={true}
        currentMemberId="m-1"
        confirmedAttendees={[
          { memberId: "m-1", displayName: "Alice Admin" },
          { memberId: "m-2", displayName: "Bob Camper" },
          { memberId: "m-3", displayName: "Charlie Volunteer" },
        ]}
        api={mockApi}
      />
    );

    const addBtn = await screen.findByRole("button", { name: /\+ Add Shared Expense/i });
    await user.click(addBtn);

    const splitList = screen.getByTestId("expense-split-list");
    const aliceCheckbox = within(splitList).getByLabelText(/Alice Admin/i);
    const bobCheckbox = within(splitList).getByLabelText(/Bob Camper/i);
    const charlieCheckbox = within(splitList).getByLabelText(/Charlie Volunteer/i);

    // Initially all 3 are checked
    expect(aliceCheckbox).toBeChecked();
    expect(bobCheckbox).toBeChecked();
    expect(charlieCheckbox).toBeChecked();

    // Verify Select All and Clear shortcuts are both visible
    const clearBtn = screen.getByRole("button", { name: /^Clear$/i });
    const selectAllBtn = screen.getByRole("button", { name: /^Select All$/i });
    expect(clearBtn).toBeInTheDocument();
    expect(selectAllBtn).toBeInTheDocument();

    // Click Clear / Deselect All
    await user.click(clearBtn);
    expect(aliceCheckbox).not.toBeChecked();
    expect(bobCheckbox).not.toBeChecked();
    expect(charlieCheckbox).not.toBeChecked();

    // Counter signals no participants selected
    expect(screen.getByText(/Please select at least one participant/i)).toBeInTheDocument();

    // Verify submit button is disabled when 0 participants are selected
    const saveBtn = screen.getByRole("button", { name: /Save Expense/i });
    expect(saveBtn).toBeDisabled();

    // Verify form submission is blocked and does not call API when 0 participants are selected
    await user.type(screen.getByPlaceholderText("25.00"), "20.00");
    const form = screen.getByText(/\+ Record Shared Expense/i).closest("div")?.querySelector("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form!);
    expect(screen.getByText(/Please select at least one participant to split this expense/i)).toBeInTheDocument();
    expect(mockApi).not.toHaveBeenCalledWith("admin_manage_trip_expense", expect.anything());

    // Click Select All
    await user.click(selectAllBtn);
    expect(aliceCheckbox).toBeChecked();
    expect(bobCheckbox).toBeChecked();
    expect(charlieCheckbox).toBeChecked();
    expect(screen.getByText(/Splitting equally among 3 participants: ~\$6\.67 each/i)).toBeInTheDocument();
    expect(saveBtn).toBeEnabled();
  });

  it("shows real-time estimated per-person split calculation as amount and participants change", async () => {
    const user = userEvent.setup();
    const mockApi = vi.fn().mockImplementation((action: string) => {
      if (action === "get_trip_financials") {
        return Promise.resolve(mockFinancials);
      }
      return Promise.resolve({});
    });

    render(
      <TripFinancialsTab
        tripId="trip-test-1"
        isAdmin={true}
        isConfirmedAttendee={true}
        currentMemberId="m-1"
        confirmedAttendees={[
          { memberId: "m-1", displayName: "Alice Admin" },
          { memberId: "m-2", displayName: "Bob Camper" },
          { memberId: "m-3", displayName: "Charlie Volunteer" },
        ]}
        api={mockApi}
      />
    );

    const addBtn = await screen.findByRole("button", { name: /\+ Add Shared Expense/i });
    await user.click(addBtn);

    // Type 60.00
    const amountInput = screen.getByPlaceholderText("25.00");
    await user.type(amountInput, "60.00");

    // All 3 selected -> ~$20.00 each
    expect(screen.getByText(/Splitting equally among 3 participants: ~\$20\.00 each/i)).toBeInTheDocument();

    // Deselect Bob -> 2 remaining -> ~$30.00 each
    const splitList = screen.getByTestId("expense-split-list");
    const bobCheckbox = within(splitList).getByLabelText(/Bob Camper/i);
    await user.click(bobCheckbox);
    expect(bobCheckbox).not.toBeChecked();
    expect(screen.getByText(/Splitting equally among 2 participants: ~\$30\.00 each/i)).toBeInTheDocument();
  });

  it("enforces exact integer cent allocation summing to amount_cents when submitting", async () => {
    const user = userEvent.setup();
    const mockApi = vi.fn().mockImplementation((action: string) => {
      if (action === "get_trip_financials") {
        return Promise.resolve(mockFinancials);
      }
      if (action === "admin_manage_trip_expense") {
        return Promise.resolve({ success: true, expense_id: "exp-1" });
      }
      return Promise.resolve({});
    });

    render(
      <TripFinancialsTab
        tripId="trip-test-1"
        isAdmin={true}
        isConfirmedAttendee={true}
        currentMemberId="m-1"
        confirmedAttendees={[
          { memberId: "m-1", displayName: "Alice Admin" },
          { memberId: "m-2", displayName: "Bob Camper" },
          { memberId: "m-3", displayName: "Charlie Volunteer" },
        ]}
        api={mockApi}
      />
    );

    const addBtn = await screen.findByRole("button", { name: /\+ Add Shared Expense/i });
    await user.click(addBtn);

    await user.type(screen.getByPlaceholderText(/e\.g\. S'mores, firewood, groceries/i), "Campground S'mores");
    // $25.00 = 2500 cents divided among 3: 834, 833, 833 cents = exactly 2500 cents
    await user.type(screen.getByPlaceholderText("25.00"), "25.00");

    const form = screen.getByText(/\+ Record Shared Expense/i).closest("div")?.querySelector("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form!);

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith(
        "admin_manage_trip_expense",
        expect.objectContaining({
          action: "create",
          amountCents: 2500,
          description: "Campground S'mores",
          allocations: expect.arrayContaining([
            expect.objectContaining({ memberId: "m-1" }),
            expect.objectContaining({ memberId: "m-2" }),
            expect.objectContaining({ memberId: "m-3" }),
          ]),
        })
      );
    });

    // Check that allocations sum to exactly 2500 cents
    const callArgs = mockApi.mock.calls.find((c) => c[0] === "admin_manage_trip_expense")?.[1];
    expect(callArgs).toBeDefined();
    const sumAllocations = callArgs.allocations.reduce(
      (sum: number, a: { allocatedCents: number }) => sum + a.allocatedCents,
      0
    );
    expect(sumAllocations).toBe(2500);
  });
});
