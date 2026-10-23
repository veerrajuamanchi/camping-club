import { describe, expect, it } from "vitest";
import {
  calculateEqualAllocations,
  computeSettlement,
  type ExpenseInput,
} from "./settlementEngine";

describe("Settlement Engine: Deterministic Integer-Cent Math", () => {
  it("distributes remainder cents deterministically to the lexicographically first UUIDs", () => {
    const memberIds = ["uuid-c", "uuid-a", "uuid-b"];
    // 100 cents across 3 people -> 34, 33, 33
    const allocations = calculateEqualAllocations(100, memberIds);

    expect(allocations).toHaveLength(3);
    const map = new Map(allocations.map((a) => [a.memberId, a.allocatedCents]));

    expect(map.get("uuid-a")).toBe(34); // uuid-a is first lexicographically
    expect(map.get("uuid-b")).toBe(33);
    expect(map.get("uuid-c")).toBe(33);

    const total = allocations.reduce((sum, a) => sum + a.allocatedCents, 0);
    expect(total).toBe(100);
  });

  it("settles Worked Example 1: 4 attendees, $240 cabin invoice paid by A", () => {
    const memberIds = ["member-a", "member-b", "member-c", "member-d"];
    const cabinExpense: ExpenseInput = {
      id: "exp-1",
      payerMemberId: "member-a",
      amountCents: 24000, // $240.00
      allocations: [
        { memberId: "member-a", allocatedCents: 6000 },
        { memberId: "member-b", allocatedCents: 6000 },
        { memberId: "member-c", allocatedCents: 6000 },
        { memberId: "member-d", allocatedCents: 6000 },
      ],
    };

    const result = computeSettlement(memberIds, [cabinExpense]);

    expect(result.algorithmUsed).toBe("exact");
    expect(result.totalExpensesCents).toBe(24000);

    // Net balances: A is creditor (+18000), B/C/D are debtors (-6000 each)
    const balA = result.balances.find((b) => b.memberId === "member-a");
    const balB = result.balances.find((b) => b.memberId === "member-b");
    expect(balA?.netBalanceCents).toBe(18000);
    expect(balB?.netBalanceCents).toBe(-6000);

    // Transfers: B, C, D each pay A $60.00 (6000 cents)
    expect(result.transfers).toHaveLength(3);
    expect(result.transfers).toEqual([
      { payerMemberId: "member-b", recipientMemberId: "member-a", amountCents: 6000 },
      { payerMemberId: "member-c", recipientMemberId: "member-a", amountCents: 6000 },
      { payerMemberId: "member-d", recipientMemberId: "member-a", amountCents: 6000 },
    ]);
  });

  it("settles Worked Example 1 WITH confirmed $50 deposits: B, C, D each paid $50 to A", () => {
    const memberIds = ["member-a", "member-b", "member-c", "member-d"];
    const cabinExpense: ExpenseInput = {
      id: "exp-1",
      payerMemberId: "member-a",
      amountCents: 24000, // $240.00
      allocations: [
        { memberId: "member-a", allocatedCents: 6000 },
        { memberId: "member-b", allocatedCents: 6000 },
        { memberId: "member-c", allocatedCents: 6000 },
        { memberId: "member-d", allocatedCents: 6000 },
      ],
    };
    const deposits = [
      { payerMemberId: "member-b", recipientMemberId: "member-a", amountCents: 5000 },
      { payerMemberId: "member-c", recipientMemberId: "member-a", amountCents: 5000 },
      { payerMemberId: "member-d", recipientMemberId: "member-a", amountCents: 5000 },
    ];

    const result = computeSettlement(memberIds, [cabinExpense], deposits);

    expect(result.algorithmUsed).toBe("exact");
    expect(result.totalExpensesCents).toBe(24000);

    // After $50 receipts: A net +3000 (+$30), B/C/D each net -1000 (-$10)
    const balA = result.balances.find((b) => b.memberId === "member-a");
    const balB = result.balances.find((b) => b.memberId === "member-b");
    const balC = result.balances.find((b) => b.memberId === "member-c");
    const balD = result.balances.find((b) => b.memberId === "member-d");

    expect(balA?.netBalanceCents).toBe(3000);
    expect(balB?.netBalanceCents).toBe(-1000);
    expect(balC?.netBalanceCents).toBe(-1000);
    expect(balD?.netBalanceCents).toBe(-1000);

    // Candidate transfers: B, C, D each transfer $10.00 (1000 cents) to A
    expect(result.transfers).toEqual([
      { payerMemberId: "member-b", recipientMemberId: "member-a", amountCents: 1000 },
      { payerMemberId: "member-c", recipientMemberId: "member-a", amountCents: 1000 },
      { payerMemberId: "member-d", recipientMemberId: "member-a", amountCents: 1000 },
    ]);
  });

  it("settles 7 attendees, $504 cabin expense paid by Manmohan with six $50 deposits", () => {
    const memberIds = [
      "m-manmohan",
      "m-veerraju",
      "m-srini",
      "m-sharat",
      "m-mahesh",
      "m-harish",
      "m-bjeereddy",
    ];
    // $504.00 split equally 7 ways = $72.00 each
    const allocations = calculateEqualAllocations(50400, memberIds);
    const cabinExpense: ExpenseInput = {
      id: "exp-cabin",
      payerMemberId: "m-manmohan",
      amountCents: 50400,
      allocations,
    };

    // The other 6 attendees each sent $50.00 deposit to Manmohan
    const otherMemberIds = memberIds.filter((id) => id !== "m-manmohan");
    const deposits = otherMemberIds.map((id) => ({
      payerMemberId: id,
      recipientMemberId: "m-manmohan",
      amountCents: 5000,
    }));

    const result = computeSettlement(memberIds, [cabinExpense], deposits);

    // Total expense remains $504.00
    expect(result.totalExpensesCents).toBe(50400);

    // Manmohan: $504 paid - $300 deposits received - $72 share = +$132.00
    const manmohanBal = result.balances.find((b) => b.memberId === "m-manmohan");
    expect(manmohanBal?.netBalanceCents).toBe(13200);

    // Each of the 6 other attendees: $50 deposit paid - $72 share = -$22.00
    for (const id of otherMemberIds) {
      const bal = result.balances.find((b) => b.memberId === id);
      expect(bal?.netBalanceCents).toBe(-2200);
      expect(bal?.totalPaidCents).toBe(5000);
      expect(bal?.totalAllocatedCents).toBe(7200);
    }

    // Transfers: 6 transfers of $22.00 to Manmohan, total $132.00
    expect(result.transfers).toHaveLength(6);
    for (const tx of result.transfers) {
      expect(tx.recipientMemberId).toBe("m-manmohan");
      expect(tx.amountCents).toBe(2200);
    }
  });

  it("settles multi-payer shared groceries and carpool fuel with minimum transfers", () => {
    const memberIds = ["dave", "sarah", "tom"];
    // Dave pays $90 for food (shared 3 ways = $30 each)
    // Sarah pays $30 for fuel (shared between Sarah and Tom = $15 each)
    const expenses: ExpenseInput[] = [
      {
        id: "exp-1",
        payerMemberId: "dave",
        amountCents: 9000,
        allocations: [
          { memberId: "dave", allocatedCents: 3000 },
          { memberId: "sarah", allocatedCents: 3000 },
          { memberId: "tom", allocatedCents: 3000 },
        ],
      },
      {
        id: "exp-2",
        payerMemberId: "sarah",
        amountCents: 3000,
        allocations: [
          { memberId: "sarah", allocatedCents: 1500 },
          { memberId: "tom", allocatedCents: 1500 },
        ],
      },
    ];

    const result = computeSettlement(memberIds, expenses);

    // Dave: paid 9000, allocated 3000 -> net +6000
    // Sarah: paid 3000, allocated 4500 -> net -1500
    // Tom: paid 0, allocated 4500 -> net -4500
    const daveBal = result.balances.find((b) => b.memberId === "dave");
    const sarahBal = result.balances.find((b) => b.memberId === "sarah");
    const tomBal = result.balances.find((b) => b.memberId === "tom");

    expect(daveBal?.netBalanceCents).toBe(6000);
    expect(sarahBal?.netBalanceCents).toBe(-1500);
    expect(tomBal?.netBalanceCents).toBe(-4500);

    // Optimal transfers: Sarah pays Dave $15.00, Tom pays Dave $45.00
    expect(result.transfers).toEqual([
      { payerMemberId: "sarah", recipientMemberId: "dave", amountCents: 1500 },
      { payerMemberId: "tom", recipientMemberId: "dave", amountCents: 4500 },
    ]);
  });

  it("throws error if allocation cents do not sum to total expense cents", () => {
    const memberIds = ["member-1", "member-2"];
    const invalidExpense: ExpenseInput = {
      id: "bad-exp",
      payerMemberId: "member-1",
      amountCents: 5000,
      allocations: [
        { memberId: "member-1", allocatedCents: 2000 },
        { memberId: "member-2", allocatedCents: 2000 }, // sum = 4000 != 5000
      ],
    };

    expect(() => computeSettlement(memberIds, [invalidExpense])).toThrow(
      /allocations sum \(4000\) does not equal total amount \(5000\)/
    );
  });

  describe("dynamic all_attendees expense allocation", () => {
    it("guards against zero attendees without dividing by zero", () => {
      const allocs = calculateEqualAllocations(6000, []);
      expect(allocs).toEqual([]);
    });

    it("handles zero or negative amounts safely by returning 0 cents allocated", () => {
      const attendees = ["m-2", "m-1"];
      expect(calculateEqualAllocations(0, attendees)).toEqual([
        { memberId: "m-1", allocatedCents: 0 },
        { memberId: "m-2", allocatedCents: 0 },
      ]);
      expect(calculateEqualAllocations(-500, attendees)).toEqual([
        { memberId: "m-1", allocatedCents: 0 },
        { memberId: "m-2", allocatedCents: 0 },
      ]);
    });

    it("dynamically reallocates exact cents when a 5th attendee joins a 4-person split", () => {
      const attendees4 = ["m-1", "m-2", "m-3", "m-4"];
      const split4 = calculateEqualAllocations(6000, attendees4);
      expect(split4).toHaveLength(4);
      expect(split4.every((a) => a.allocatedCents === 1500)).toBe(true);
      expect(split4.reduce((sum, a) => sum + a.allocatedCents, 0)).toBe(6000);

      const attendees5 = ["m-1", "m-2", "m-3", "m-4", "m-5"];
      const split5 = calculateEqualAllocations(6000, attendees5);
      expect(split5).toHaveLength(5);
      expect(split5.every((a) => a.allocatedCents === 1200)).toBe(true);
      expect(split5.reduce((sum, a) => sum + a.allocatedCents, 0)).toBe(6000);
    });

    it("handles odd cents remainder deterministically with canonical sorting", () => {
      const attendees3 = ["m-c", "m-a", "m-b"];
      const split = calculateEqualAllocations(1000, attendees3);
      expect(split.reduce((sum, a) => sum + a.allocatedCents, 0)).toBe(1000);
      // 1000 / 3 = 333 rem 1. Canonical order: m-a gets 334, m-b gets 333, m-c gets 333
      expect(split.find((a) => a.memberId === "m-a")?.allocatedCents).toBe(334);
      expect(split.find((a) => a.memberId === "m-b")?.allocatedCents).toBe(333);
      expect(split.find((a) => a.memberId === "m-c")?.allocatedCents).toBe(333);
    });
  });
});
