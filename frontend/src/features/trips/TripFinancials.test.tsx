import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  TripFinancialsTab,
  type TripFinancialsData,
} from "./TripFinancialsTab";

const mockDraftFinancials: TripFinancialsData = {
  tripId: "trip-1",
  isFinalized: false,
  cabinDeposit: {
    payerMemberId: "member-admin",
    payerName: "Alice Admin",
    depositPerPersonCents: 5000,
    confirmedCount: 3,
    amountCents: 15000,
    allocations: [
      { memberId: "member-admin", memberName: "Alice Admin", allocatedCents: 5000, isMe: false },
      { memberId: "member-1", memberName: "Dave K.", allocatedCents: 5000, isMe: true },
      { memberId: "member-2", memberName: "Sarah M.", allocatedCents: 5000, isMe: false },
    ],
  },
  carpoolReimbursements: [
    {
      carpoolId: "cp-1",
      driverMemberId: "member-2",
      driverName: "Sarah M.",
      vehicleDescription: "Silver Subaru",
      milesDriven: 100,
      amountCents: 7600,
      occupantCount: 3,
      occupantNames: ["Sarah M.", "Dave K.", "Alice Admin"],
      allocations: [
        { memberId: "member-2", memberName: "Sarah M.", allocatedCents: 2534, isMe: false },
        { memberId: "member-1", memberName: "Dave K.", allocatedCents: 2533, isMe: true },
        { memberId: "member-admin", memberName: "Alice Admin", allocatedCents: 2533, isMe: false },
      ],
    },
  ],
  expenses: [
    {
      id: "exp-1",
      expenseType: "shared_receipt",
      payerMemberId: "member-1",
      payerName: "Dave K.",
      amountCents: 4500,
      description: "Campfire S'mores and firewood",
      incurredDate: "2026-10-18",
      receiptUrl: "https://example.com/receipt.jpg",
      isLocked: false,
      allocations: [
        { memberId: "member-admin", memberName: "Alice Admin", allocatedCents: 1500, isMe: false },
        { memberId: "member-1", memberName: "Dave K.", allocatedCents: 1500, isMe: true },
        { memberId: "member-2", memberName: "Sarah M.", allocatedCents: 1500, isMe: false },
      ],
    },
  ],
  settlementRun: {
    id: null,
    versionNo: 0,
    status: "draft",
    totalExpensesCents: 27100,
    algorithmUsed: "exact",
    finalizedAt: null,
    settledAt: null,
  },
  balances: [
    {
      memberId: "member-admin",
      displayName: "Alice Admin",
      totalPaidCents: 15000,
      totalAllocatedCents: 9033,
      netBalanceCents: 5967,
      isMe: false,
    },
    {
      memberId: "member-2",
      displayName: "Sarah M.",
      totalPaidCents: 7600,
      totalAllocatedCents: 9034,
      netBalanceCents: -1434,
      isMe: false,
    },
    {
      memberId: "member-1",
      displayName: "Dave K.",
      totalPaidCents: 4500,
      totalAllocatedCents: 9033,
      netBalanceCents: -4533,
      isMe: true,
    },
  ],
  transfers: [
    {
      id: "draft-0",
      payerMemberId: "member-1",
      payerName: "Dave K.",
      recipientMemberId: "member-admin",
      recipientName: "Alice Admin",
      amountCents: 4533,
      status: "outstanding",
      markedSentAt: null,
      confirmedReceivedAt: null,
      paymentMethod: null,
      recipientPreferredMethod: "Zelle",
      notes: null,
      isPayer: true,
      isRecipient: false,
    },
    {
      id: "draft-1",
      payerMemberId: "member-2",
      payerName: "Sarah M.",
      recipientMemberId: "member-admin",
      recipientName: "Alice Admin",
      amountCents: 1434,
      status: "outstanding",
      markedSentAt: null,
      confirmedReceivedAt: null,
      paymentMethod: null,
      recipientPreferredMethod: "Zelle",
      notes: null,
      isPayer: false,
      isRecipient: false,
    },
  ],
};

const mockFinalizedFinancials: TripFinancialsData = {
  ...mockDraftFinancials,
  isFinalized: true,
  settlementRun: {
    id: "run-1",
    versionNo: 1,
    status: "finalized",
    totalExpensesCents: 27100,
    algorithmUsed: "exact",
    finalizedAt: "2026-10-18T18:00:00Z",
    settledAt: null,
  },
  transfers: [
    {
      id: "tx-1",
      payerMemberId: "member-1",
      payerName: "Dave K.",
      recipientMemberId: "member-admin",
      recipientName: "Alice Admin",
      amountCents: 4533,
      status: "outstanding",
      markedSentAt: null,
      confirmedReceivedAt: null,
      paymentMethod: null,
      recipientPreferredMethod: "Zelle",
      notes: null,
      isPayer: true,
      isRecipient: false,
    },
    {
      id: "tx-2",
      payerMemberId: "member-2",
      payerName: "Sarah M.",
      recipientMemberId: "member-admin",
      recipientName: "Alice Admin",
      amountCents: 1434,
      status: "sent",
      markedSentAt: "2026-10-18T19:00:00Z",
      confirmedReceivedAt: null,
      paymentMethod: "venmo",
      recipientPreferredMethod: "Zelle",
      notes: "Sent via Venmo",
      isPayer: false,
      isRecipient: false,
    },
  ],
};

describe("Phase 5: Unified Expense Ledger & Settlement Engine", () => {
  it("renders draft settlement preview with unified ledger and algorithm metrics", async () => {
    const mockApi = vi.fn().mockImplementation((action: string) => {
      if (action === "get_trip_financials") {
        return Promise.resolve(mockDraftFinancials);
      }
      return Promise.resolve({});
    });

    render(
      <TripFinancialsTab
        tripId="trip-1"
        isAdmin={true}
        isConfirmedAttendee={true}
        currentMemberId="member-1"
        confirmedAttendees={[
          { memberId: "member-admin", displayName: "Alice Admin" },
          { memberId: "member-1", displayName: "Dave K." },
          { memberId: "member-2", displayName: "Sarah M." },
        ]}
        api={mockApi}
      />
    );

    // Header & badge
    expect(await screen.findByText(/Draft Calculation/i)).toBeInTheDocument();
    expect(screen.getByText("$271.00")).toBeInTheDocument();
    expect(screen.getByText("Exact (DP)")).toBeInTheDocument();

    // Cabin deposit
    expect(screen.getByText(/Cabin Deposit Advance/i)).toBeInTheDocument();
    expect(screen.getAllByText("$150.00").length).toBeGreaterThan(0);

    // Carpool reimbursement ($0.76/mi)
    expect(screen.getByText(/Carpool Mileage Reimbursements \(\$0\.76\/mile\)/i)).toBeInTheDocument();
    expect(screen.getAllByText("$76.00").length).toBeGreaterThan(0);

    // Shared receipts
    expect(screen.getByText("Campfire S'mores and firewood")).toBeInTheDocument();
    expect(screen.getAllByText("$45.00").length).toBeGreaterThan(0);

    // Member Balances table
    expect(screen.getAllByText("Alice Admin").length).toBeGreaterThan(0);
    expect(screen.getByText("+$59.67")).toBeInTheDocument();
  });

  it("allows admin to add a shared receipt with automatic equal split", async () => {
    const user = userEvent.setup();
    const mockApi = vi.fn().mockImplementation((action: string) => {
      if (action === "get_trip_financials") {
        return Promise.resolve(mockDraftFinancials);
      }
      if (action === "admin_manage_trip_expense") {
        return Promise.resolve({ success: true, expense_id: "exp-2" });
      }
      return Promise.resolve({});
    });

    render(
      <TripFinancialsTab
        tripId="trip-1"
        isAdmin={true}
        isConfirmedAttendee={true}
        currentMemberId="member-1"
        confirmedAttendees={[
          { memberId: "member-admin", displayName: "Alice Admin" },
          { memberId: "member-1", displayName: "Dave K." },
          { memberId: "member-2", displayName: "Sarah M." },
        ]}
        api={mockApi}
      />
    );

    const addBtn = await screen.findByRole("button", { name: /\+ Add Shared Expense/i });
    await user.click(addBtn);

    expect(screen.getByText(/\+ Record Shared Expense/i)).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText(/e\.g\. S'mores, firewood, groceries/i), "Sunday Breakfast Bacon");
    await user.type(screen.getByPlaceholderText("25.00"), "30.00");

    const form = screen.getByText(/\+ Record Shared Expense/i).closest("div")?.querySelector("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form!);

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith(
        "admin_manage_trip_expense",
        expect.objectContaining({
          action: "create",
          amountCents: 3000,
          description: "Sunday Breakfast Bacon",
          allocations: [
            { memberId: "member-admin", allocatedCents: 1000 },
            { memberId: "member-1", allocatedCents: 1000 },
            { memberId: "member-2", allocatedCents: 1000 },
          ],
        })
      );
    });
  });

  it("allows selecting specific participants to document and split the expense", async () => {
    const user = userEvent.setup();
    const mockApi = vi.fn().mockImplementation((action: string) => {
      if (action === "get_trip_financials") {
        return Promise.resolve(mockDraftFinancials);
      }
      if (action === "admin_manage_trip_expense") {
        return Promise.resolve({ success: true, expense_id: "exp-3" });
      }
      return Promise.resolve({});
    });

    render(
      <TripFinancialsTab
        tripId="trip-1"
        isAdmin={false}
        isConfirmedAttendee={true}
        currentMemberId="member-1"
        confirmedAttendees={[
          { memberId: "member-admin", displayName: "Alice Admin" },
          { memberId: "member-1", displayName: "Dave K." },
          { memberId: "member-2", displayName: "Sarah M." },
        ]}
        api={mockApi}
      />
    );

    const addBtn = await screen.findByRole("button", { name: /\+ Add Shared Expense/i });
    await user.click(addBtn);

    await user.type(screen.getByPlaceholderText(/e\.g\. S'mores, firewood, groceries/i), "Steak for Dave and Sarah");
    await user.type(screen.getByPlaceholderText("25.00"), "40.00");

    // Deselect Alice Admin
    const aliceCheckbox = screen.getByLabelText(/Alice Admin/i);
    expect(aliceCheckbox).toBeChecked();
    await user.click(aliceCheckbox);
    expect(aliceCheckbox).not.toBeChecked();

    const form = screen.getByText(/\+ Record Shared Expense/i).closest("div")?.querySelector("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form!);

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith(
        "admin_manage_trip_expense",
        expect.objectContaining({
          action: "create",
          amountCents: 4000,
          description: "Steak for Dave and Sarah",
          allocations: [
            { memberId: "member-1", allocatedCents: 2000 },
            { memberId: "member-2", allocatedCents: 2000 },
          ],
        })
      );
    });
  });

  it("allows admin to lock and finalize settlement", async () => {
    const user = userEvent.setup();
    const mockApi = vi.fn().mockImplementation((action: string) => {
      if (action === "get_trip_financials") {
        return Promise.resolve(mockDraftFinancials);
      }
      if (action === "admin_finalize_settlement") {
        return Promise.resolve({ success: true, status: "finalized" });
      }
      return Promise.resolve({});
    });

    render(
      <TripFinancialsTab
        tripId="trip-1"
        isAdmin={true}
        isConfirmedAttendee={true}
        currentMemberId="member-admin"
        confirmedAttendees={[
          { memberId: "member-admin", displayName: "Alice Admin" },
          { memberId: "member-1", displayName: "Dave K." },
        ]}
        api={mockApi}
      />
    );

    const finalizeBtn = await screen.findByRole("button", { name: /🔒 Lock & Finalize Settlement/i });
    await user.click(finalizeBtn);

    expect(screen.getByText(/Lock & Finalize Settlement\?/i)).toBeInTheDocument();

    const confirmBtn = screen.getByRole("button", { name: /Yes, Finalize Settlement/i });
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith("admin_finalize_settlement", { tripId: "trip-1" });
    });
  });

  it("handles two-stage payment confirmation: Mark Sent and Confirm Received", async () => {
    const user = userEvent.setup();
    const mockApi = vi.fn().mockImplementation((action: string) => {
      if (action === "get_trip_financials") {
        return Promise.resolve(mockFinalizedFinancials);
      }
      if (action === "update_settlement_transfer") {
        return Promise.resolve({ success: true });
      }
      return Promise.resolve({});
    });

    render(
      <TripFinancialsTab
        tripId="trip-1"
        isAdmin={true}
        isConfirmedAttendee={true}
        currentMemberId="member-1"
        confirmedAttendees={[
          { memberId: "member-admin", displayName: "Alice Admin" },
          { memberId: "member-1", displayName: "Dave K." },
          { memberId: "member-2", displayName: "Sarah M." },
        ]}
        api={mockApi}
      />
    );

    // Dave is payer for tx-1 ($45.33) -> can Mark Sent
    expect(await screen.findByText(/🔒 Financially Finalized/i)).toBeInTheDocument();
    const markSentBtn = screen.getByRole("button", { name: /Mark Sent/i });
    await user.click(markSentBtn);

    expect(screen.getByText(/Mark Payment as Sent/i)).toBeInTheDocument();
    const form = screen.getByText(/Mark Payment as Sent/i).closest("div")?.querySelector("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form!);

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith(
        "update_settlement_transfer",
        expect.objectContaining({
          transferId: "tx-1",
          action: "mark_sent",
          paymentMethod: "zelle",
        })
      );
    });

    // Admin can confirm receipt for sent transfer (tx-2)
    const confirmButtons = screen.getAllByRole("button", { name: /Confirm \(Admin\)/i });
    expect(confirmButtons.length).toBeGreaterThan(0);
    await user.click(confirmButtons[1] ?? confirmButtons[0]);

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith(
        "update_settlement_transfer",
        expect.objectContaining({
          transferId: "tx-2",
          action: "confirm_received",
        })
      );
    });
  });
});
