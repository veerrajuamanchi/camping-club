// Pure Deterministic Integer-Cent Settlement Engine (Edge Functions)

export type ExpenseAllocationInput = {
  memberId: string;
  allocatedCents: number;
};

export type ExpenseInput = {
  id: string;
  payerMemberId: string;
  amountCents: number;
  allocations: ExpenseAllocationInput[];
};

export type MemberBalanceResult = {
  memberId: string;
  totalPaidCents: number;
  totalAllocatedCents: number;
  netBalanceCents: number;
};

export type SettlementTransferResult = {
  payerMemberId: string;
  recipientMemberId: string;
  amountCents: number;
};

export type SettlementEngineResult = {
  balances: MemberBalanceResult[];
  transfers: SettlementTransferResult[];
  totalExpensesCents: number;
  algorithmUsed: "exact" | "greedy_fallback";
};

export function calculateEqualAllocations(
  amountCents: number,
  participantMemberIds: string[]
): ExpenseAllocationInput[] {
  if (participantMemberIds.length === 0) return [];
  if (amountCents <= 0) {
    return participantMemberIds.map((id) => ({ memberId: id, allocatedCents: 0 }));
  }

  const sortedIds = [...participantMemberIds].sort();
  const k = sortedIds.length;
  const base = Math.floor(amountCents / k);
  const remainder = amountCents % k;

  return sortedIds.map((memberId, idx) => ({
    memberId,
    allocatedCents: idx < remainder ? base + 1 : base,
  }));
}

export function computeSettlement(
  memberIds: string[],
  expenses: ExpenseInput[]
): SettlementEngineResult {
  const paidMap = new Map<string, number>();
  const allocatedMap = new Map<string, number>();

  for (const id of memberIds) {
    paidMap.set(id, 0);
    allocatedMap.set(id, 0);
  }

  let totalExpensesCents = 0;

  for (const exp of expenses) {
    totalExpensesCents += exp.amountCents;
    paidMap.set(exp.payerMemberId, (paidMap.get(exp.payerMemberId) ?? 0) + exp.amountCents);

    let expAllocSum = 0;
    for (const alloc of exp.allocations) {
      expAllocSum += alloc.allocatedCents;
      allocatedMap.set(alloc.memberId, (allocatedMap.get(alloc.memberId) ?? 0) + alloc.allocatedCents);
    }

    if (expAllocSum !== exp.amountCents) {
      throw new Error(`Expense ${exp.id} allocations sum (${expAllocSum}) does not equal total amount (${exp.amountCents}).`);
    }
  }

  const balances: MemberBalanceResult[] = memberIds.map((memberId) => {
    const totalPaid = paidMap.get(memberId) ?? 0;
    const totalAllocated = allocatedMap.get(memberId) ?? 0;
    return {
      memberId,
      totalPaidCents: totalPaid,
      totalAllocatedCents: totalAllocated,
      netBalanceCents: totalPaid - totalAllocated,
    };
  });

  const sumNet = balances.reduce((acc, b) => acc + b.netBalanceCents, 0);
  if (sumNet !== 0) {
    throw new Error(`Conservation of money violated: sum of net balances is ${sumNet} cents (must be exactly 0).`);
  }

  const nonzero = balances.filter((b) => b.netBalanceCents !== 0);
  nonzero.sort((a, b) => a.memberId.localeCompare(b.memberId));

  if (nonzero.length === 0) {
    return {
      balances,
      transfers: [],
      totalExpensesCents,
      algorithmUsed: "exact",
    };
  }

  let transfers: SettlementTransferResult[];
  let algorithmUsed: "exact" | "greedy_fallback";

  if (nonzero.length <= 12) {
    algorithmUsed = "exact";
    transfers = solveExactTransfers(nonzero);
  } else {
    algorithmUsed = "greedy_fallback";
    transfers = solveGreedyTransfers(nonzero);
  }

  transfers.sort((a, b) => {
    const cmp = a.payerMemberId.localeCompare(b.payerMemberId);
    return cmp !== 0 ? cmp : a.recipientMemberId.localeCompare(b.recipientMemberId);
  });

  return {
    balances,
    transfers,
    totalExpensesCents,
    algorithmUsed,
  };
}

function solveExactTransfers(nonzero: MemberBalanceResult[]): SettlementTransferResult[] {
  const n = nonzero.length;
  const numMasks = 1 << n;
  const subsetSums = new Int32Array(numMasks);

  for (let mask = 1; mask < numMasks; mask++) {
    const lsb = mask & -mask;
    const bitIndex = 31 - Math.clz32(lsb);
    subsetSums[mask] = subsetSums[mask ^ lsb] + nonzero[bitIndex].netBalanceCents;
  }

  const best = new Int32Array(numMasks);
  const bestChoice = new Int32Array(numMasks);

  for (let mask = 1; mask < numMasks; mask++) {
    const lsb = mask & -mask;
    const sub = mask ^ lsb;
    let s = sub;
    while (true) {
      const candidate = lsb | s;
      if (subsetSums[candidate] === 0) {
        const candidateGroups = 1 + best[mask ^ candidate];
        if (candidateGroups > best[mask]) {
          best[mask] = candidateGroups;
          bestChoice[mask] = candidate;
        }
      }
      if (s === 0) break;
      s = (s - 1) & sub;
    }
  }

  const groups: MemberBalanceResult[][] = [];
  let remaining = (1 << n) - 1;

  while (remaining > 0) {
    const chosenGroupMask = bestChoice[remaining];
    if (chosenGroupMask === 0) {
      const grp: MemberBalanceResult[] = [];
      for (let i = 0; i < n; i++) {
        if ((remaining & (1 << i)) !== 0) grp.push(nonzero[i]);
      }
      groups.push(grp);
      break;
    }

    const grp: MemberBalanceResult[] = [];
    for (let i = 0; i < n; i++) {
      if ((chosenGroupMask & (1 << i)) !== 0) grp.push(nonzero[i]);
    }
    groups.push(grp);
    remaining ^= chosenGroupMask;
  }

  const allTransfers: SettlementTransferResult[] = [];
  for (const grp of groups) {
    allTransfers.push(...solveGreedyTransfers(grp));
  }

  return allTransfers;
}

function solveGreedyTransfers(members: MemberBalanceResult[]): SettlementTransferResult[] {
  const debtors: Array<{ memberId: string; debt: number }> = [];
  const creditors: Array<{ memberId: string; credit: number }> = [];

  for (const m of members) {
    if (m.netBalanceCents < 0) {
      debtors.push({ memberId: m.memberId, debt: Math.abs(m.netBalanceCents) });
    } else if (m.netBalanceCents > 0) {
      creditors.push({ memberId: m.memberId, credit: m.netBalanceCents });
    }
  }

  const sortDebtors = () =>
    debtors.sort((a, b) => (b.debt !== a.debt ? b.debt - a.debt : a.memberId.localeCompare(b.memberId)));
  const sortCreditors = () =>
    creditors.sort((a, b) => (b.credit !== a.credit ? b.credit - a.credit : a.memberId.localeCompare(b.memberId)));

  sortDebtors();
  sortCreditors();

  const transfers: SettlementTransferResult[] = [];

  while (debtors.length > 0 && creditors.length > 0) {
    const topDebtor = debtors[0];
    const topCreditor = creditors[0];

    const transferAmount = Math.min(topDebtor.debt, topCreditor.credit);

    if (transferAmount > 0) {
      transfers.push({
        payerMemberId: topDebtor.memberId,
        recipientMemberId: topCreditor.memberId,
        amountCents: transferAmount,
      });

      topDebtor.debt -= transferAmount;
      topCreditor.credit -= transferAmount;
    }

    if (topDebtor.debt === 0) debtors.shift();
    if (topCreditor.credit === 0) creditors.shift();

    sortDebtors();
    sortCreditors();
  }

  return transfers;
}
