# Settlement Engine Specification

**Status:** Planning contract. Exact cap/fallback requires owner approval. Cabin minimum basis, cancellation disposition, and contribution-excess treatment are unresolved owner decisions; no automated financial policy is active for them.
**Implementation:** Pure deterministic TypeScript package, called by trusted server operations only.
**Related:** [Database Schema](DATABASE_SCHEMA.md), [API Contracts](API_CONTRACTS.md)

## 1. Goals and non-goals

The engine combines every approved trip expense, allocation subset, cabin advance, and already-paid transfer before producing reimbursement instructions. Its primary optimization objective is the fewest payment transfers. Every output is reproducible, integer-cent exact, auditable, and safe to revise after partial payment.

The engine does not initiate payments, select expense allocations from prose, determine whether a member opted into alcohol, decide club cancellation refunds, or authorize an admin action. Those are validated inputs/policies.

## 2. Exact/fallback limits proposed for owner approval

- Exact global minimum-transfer optimization when there are at most **12 nonzero net member balances** after all inputs are normalized.
- At 12, subset sums use 4,096 entries. The recurrence below tests exactly 265,720 anchor-containing candidate groups across all masks. Counting the 4,095 nonempty subset-sum additions too gives a declared bound of 269,815 primitive operations; array initialization, tie-break comparisons, and serialization are excluded and reported separately.
- Above 12 nonzero balances, use the deterministic greedy fallback in Section 6. It settles correctly but is not guaranteed to use the minimum number of transfers.
- A zero balance does not count toward the solver ceiling and produces no transfer.
- Do not choose exact/fallback based on wall-clock timing, so identical inputs always choose the same algorithm.
- The 12-person bound is a recommendation, not approved policy; owner approval is required before Phase 6 coding.

### 2.1 Operation-count derivation

For every mask of population `m`, fix the least-significant set bit as anchor and generate each candidate once as `anchor_bit | tail`, where `tail` ranges over submasks of the remaining `m-1` bits. This produces `2^(m-1)` candidate transitions for that mask and never enumerates then filters submasks. Across all masks at `n=12`, the total is `sum(C(12,m) * 2^(m-1), m=1..12) = (3^12 - 1)/2 = 265,720`. Subset-sum recurrence adds one value for each of the 4,095 nonempty masks. Exact mode asserts both counts. Exceeding either bound is a certification failure; it must not return a partial result or silently fall back.

## 3. Input model and sign convention

All amounts are signed integer cents and must be within JavaScript Number safe-integer range. Reject NaN, Infinity, decimals, overflow, duplicate member IDs, negative expense totals, and unsupported currency.

For each member i, define net balance bᵢ:
- bᵢ > 0: member is owed money (creditor).
- bᵢ < 0: member owes money (debtor).
- bᵢ = 0: settled in the aggregate.

Each persisted ledger source uses balanced signed postings: an expense payer credit and allocation debits sum to zero; a confirmed external member-to-member payment posts equal and opposite member amounts; a policy-approved group credit pairs the appropriate member and control-account postings. `signed_amount_cents` follows the member-balance sign above for member accounts. `unapplied_contribution` is a control account, never an expense category or spendable credit. Do not run final transfer optimization while a control-account amount lacks an approved disposition. The finalized ledger retains each source event ID so a projection can be rebuilt without reapplying any source.

Required inputs:
- Trip ID, locked expense-set hash, policy snapshot ID and content hash.
- Approved expenses: expense ID, total cents, payer member ID, exact allocations.
- Confirmed receipt amounts for cabin contributions and prior settlement transfers.
- In-flight sent-but-unconfirmed transfer amounts, disputes and resolution state.
- Active attendee/withdrawal status and contribution disposition.
- Optional sender-supported methods and recipient accepted methods, only if owner approves compatibility scoring.
- Engine version and idempotency key.

For every ordinary expense:
1. Add the expense total as a credit to the member who actually paid the merchant.
2. Subtract every exact member allocation from that member's balance.
3. Require allocations to sum exactly to the expense amount.
4. The payer may be outside the allocation subset.
5. Aggregate all expenses before transfer construction.

This lets one trip combine, for example, groceries shared by four, fuel shared by three, and a cabin shared by the final attendee roster.

## 4. Cabin contribution and advance accounting

### 4.1 Collection contract

- The amended source design and later plan disagree about the four-person minimum. Amended design: active Coming members with recipient-confirmed $50 receipts. Later plan: active Coming RSVPs, with $50 requested after confirmation. Neither basis is owner-approved. Keep `minimum_basis` unset and fail closed for registration opening/deadline transitions until selected.
- Under approved `coming_rsvp`, no $50 is due before confirmation; confirmed attendees and late additions then owe $50. Under approved `received_contribution`, Coming signups owe $50 before cutoff and full recipient-confirmed receipts count. Whether the attending cabin payer's non-posting coverage marker also qualifies is a separate required owner decision. Marked-sent does not count.
- The app never moves money. The member marks sent; the assigned payer or an administrator confirms receipt. Record timestamps, actor, amount, payment method label and optional redacted external reference. No full screenshot or bank credential is required for receipt proof.
- A member who withdraws after confirmation still owes the $50. If paid, it is non-refundable under the member-withdrawal rule.
- The assigned recipient is the person recorded as having paid the cabin booking. If that payer is an attendee, record the vendor payment as a vendor fact and a non-posting `booking_coverage_acknowledged` marker for their own $50 commitment. Do not create a fictitious self-transfer or cash receipt. Record other attendees' receipts separately.

### 4.2 Applying contributions exactly once

- A confirmed receipt is a payment event, not another expense. In signed-balance terms, external payment member A → cabin payer P adds 5,000 cents to A's balance and subtracts 5,000 cents from P's balance. The vendor cabin expense and its allocations are recorded once; receipt events reduce outstanding balances and are never added to expense totals.
- A contribution marked sent but not received remains in-flight. Do not issue a duplicate payment instruction. It blocks settlement close or requires an explicit admin resolution before a correction can recreate the obligation.
- A paid contribution by a member who later withdraws is not credited back to that withdrawn member. The $50 remains non-refundable under the approved member-withdrawal rule. The contribution is not itself an expense and must not be charged again to the withdrawn member. Its final allocation against cabin cost, especially where contributions exceed the invoice or documented cancellation loss, requires an owner-approved policy. Until then, preserve it as an unapplied balance and block settlement closure; do not treat it as a credit to other trip categories.
- If a contribution is refunded by an approved resolution, append a refund event and reverse the contribution credit exactly once. Do not delete the original receipt.
- Store contribution events separately from cabin expense records. The expense is the amount paid to the provider; the contributions are reimbursements/advances. Never add a contribution as another expense.
- A cabin payer's merchant payment and the other members' contribution transfers are two distinct events. Use ledger links to reconcile them; do not net by simply replacing the cabin expense amount.
- Expense lock records the exact set of confirmed cabin credits, member shares and unpaid/in-flight obligations used in a settlement input hash.

### 4.3 Contribution excess and policy gate

The $50 is a fixed commitment per confirmed attendee, while actual cabin prices and attendee count vary. For eight attendees and a `$250` invoice paid by one attendee, there are eight nominal `$50` commitments (`$400`): seven external `$50` receipt events (`$350`) and one non-posting booking-coverage marker for the payer. Equal cabin allocations are `$31.25` per attendee; candidate balances imply `$131.25` in total returns from the cabin payer to the other seven, not `$150` of external cash. The approved design establishes the money is for cabin cost but does not define disposition above cabin allocation. Until the owner decides whether that amount is refunded, retained as a club credit, or allocated another way:

- Keep every confirmed receipt in the append-only contribution ledger.
- Apply no more than the cabin-cost amount authorized by the approved policy.
- Record any remainder as unapplied; never silently reclassify it as food, travel, or general club funds.
- Block settlement closure while an unapplied balance remains.
- Keep the settlement engine and API capable of recording the later approved resolution as a separate event without altering the original receipt.

### 4.4 Club-initiated cancellation decision

Under `coming_rsvp`, fewer than the minimum Coming at cutoff cancels before any contribution is due. Under `received_contribution`, fewer than the minimum qualifying paid participants cancels after contributions may exist. The treatment of these receipts is unresolved; preserve them as unapplied and block financial closure. A premature/extra payment under the first basis is also unapplied and requires owner-approved disposition; do not automatically retain or refund it.

If the trip was already confirmed, contributions requested, and an administrator later cancels because participation drops below the minimum, the design does **not** authorize automatic refund or automatic forfeiture. Mark all affected contribution dispositions unresolved and block settlement close until the owner-approved rule is applied. Recommended policy for owner decision: return contributions to the extent the cabin payment is refunded; apply only documented non-refundable cabin cost to the trip, allocate it by the approved cancellation rule, and return any remaining contribution balance. The administrator must record provider refund evidence and each external refund/credit event. This recommendation is not active until approved.

## 5. Exact minimum-transfer algorithm (n <= 12)

### 5.1 Minimum-count argument

For a set of n nonzero signed balances summing to zero, a zero-sum group of k members can be settled with k−1 transfers if the group has no proper zero-sum subset. Partition the members into the maximum possible number g of disjoint zero-sum groups. The minimum transfer count is n−g.

### 5.2 Dynamic program

1. Sort members by canonical lowercase UUID byte order. Remove zero balances. Assert the remaining balances sum to zero.
2. Assign bit positions 0..n−1 in that order.
3. Precompute subset sums for all masks using low-bit recurrence in O(2ⁿ).
4. Set best[0] = 0.
5. For each nonempty mask in increasing integer order, let anchor be its least-significant set bit. Generate `S = anchor_bit | tail` directly for all submasks `tail` of `mask XOR anchor_bit`; this examines each anchor-containing candidate exactly once. If sum[S] = 0, candidate = 1 + best[mask XOR S]. Keep the candidate with the greatest number of groups.
6. For equal group counts, choose the lexicographically smallest ascending UUID member list for S; repeat recursively on mask XOR S. This fixes a unique partition.
7. For each indecomposable zero-sum group, create transfers by matching debtors to creditors. Within each step choose a compatible payer/recipient pair first if compatibility data is enabled; otherwise choose by the stable ordering below. Transfer min(debt owed, credit due). Remove exhausted balances. Continue until all members in the group are zero.
8. Sort final transfer rows by payer UUID, recipient UUID, then amount cents. Store engine version, input hash, exact flag and transfer hash.

This search enumerates all zero-sum partitions because each partition has exactly one block containing the least UUID remaining. The recurrence finds the maximum group count; within each irreducible group, every stable debtor-creditor matching produces k−1 transfers because no proper zero-sum subset can be exhausted earlier.

### 5.3 Determinism and compatibility

- Stable identity ordering is canonical UUID byte order, independent of locale.
- If the owner approves recording sender-supported methods, a payer/recipient pair is compatible when the intersection of payer-supported send methods and recipient-accepted receive methods is nonempty.
- Exact transfer count remains the primary and proven optimum. Compatibility is a deterministic preference among valid minimum-count constructions, not a reason to add a transfer or change a cent.
- Deterministic pairing order: among pairs currently compatible, choose the pair with the largest min(debt,credit); ties by payer UUID then recipient UUID. If no compatible pair exists, use the largest min amount, then UUID order. This is deterministic and retains the minimum count for an irreducible block; it is not a global proof of minimum incompatible pairs.
- If compatibility is not approved or inputs are missing, use the UUID-only tie-break and show the recipient’s configured payment method in instructions.

## 6. Deterministic fallback above 12

Use largest-balance matching over all remaining nonzero balances:

1. Build debtors sorted by descending absolute debt, then UUID ascending.
2. Build creditors sorted by descending credit, then UUID ascending.
3. Transfer min(abs(largest debt), largest credit) from the first debtor to the first creditor.
4. Remove any exhausted balance, re-sort affected sides using the same keys, and repeat.
5. Stop only when no nonzero balances remain.

The fallback:
- Always preserves cents and settles each balance exactly.
- Never emits zero, negative, self, or duplicate payer/recipient transfers in one run.
- Uses at most n−1 transfers.
- Is stable for identical inputs.
- Makes no minimum-transfer claim.
- Emits a warning in preview that exact optimization was skipped because n > 12.

## 7. Remainder allocation

For equal shares of A cents across k members:
- q = floor(A/k), r = A mod k.
- Sort member UUIDs ascending.
- Assign q+1 cents to the first r members and q cents to the remainder.
- Sum must exactly equal A.

For percentages:
- Store integer basis points totaling exactly 10,000.
- Compute floor(A × basis_points / 10,000) per member.
- Distribute leftover cents one at a time by descending fractional remainder, then UUID ascending.
- Require final allocations sum exactly to A.

Do not use float arithmetic. Multiplications must remain safe integers; reject input if intermediate values exceed MAX_SAFE_INTEGER.

## 8. Finalization, paid transfers, and versioned corrections

- A preview is reproducible from input hash + policy snapshot + engine version. Finalization requires the hash still matches the locked expense/contribution state.
- Finalize in one database transaction: insert settlement version, signed balances, proposed transfers, hashes, actor/time and notification outbox messages. Unique trip/version and idempotency key prevent duplicates.
- A transfer may have multiple partial sent/received events. Cumulative confirmed receipt cannot exceed transfer amount.
- For a correction, preserve all prior finalized runs and payment events. Create a new run referencing the prior version and compute residual balances after:
  1. Confirmed received amounts (definitive settled credits).
  2. Sent-but-unconfirmed amounts (reserved in-flight; not recreated as another instruction).
  3. Explicitly resolved disputes/refunds.
- If an in-flight or disputed amount makes the adjusted balance ambiguous, block finalization until recipient/admin resolves it.
- If a correction shows overpayment, create a new reverse-direction refund obligation/adjustment event; never rewrite the original transfer.
- A run closes only when every transfer and cabin contribution is confirmed or explicitly resolved. Admin resolution requires a reason and appears in the 12-month minimal ledger.
- All events are append-only. The cleanup policy never removes records inside the approved retention period.

## 9. Financial invariants

Every preview and finalization verifies:

1. Every source amount is a positive safe integer in cents; no floats, NaN, infinity or overflow.
2. Every expense allocation total equals its approved expense total exactly.
3. Every ordinary expense allocation member belongs to the trip's approved allocation set. Cabin contributions, refunds, and credits use their separate append-only ledger and are never disguised as expense allocations.
4. Payer merchant credit plus allocation debits sum to zero across all approved expenses.
5. Cabin advances and refunds are represented once and linked to their original event.
6. All source postings, including any control account, sum to zero. Before transfer matching, no unresolved control-account posting remains and member net balances sum to zero.
7. Transfers have positive amount, distinct payer/recipient, and total outflow equals total inflow.
8. For each member, starting balance plus outgoing/incoming proposed transfer deltas equals zero.
9. The exact solver output count equals n−g from the maximum zero-sum partition.
10. Identical normalized inputs, member IDs and engine version produce identical output bytes/hashes.
11. No contribution, partial payment, prior confirmed receipt or refund is counted twice.
12. Finalized input and output hashes remain unchanged; corrections use a new version.
13. A payer excluded from an expense's allocation is still correctly represented as the party owed the merchant credit.
14. Money rounds only at allocation construction using the deterministic remainder rules.

## 10. Test vectors and required automated tests

### Deterministic examples

- Four people with balances +6,000, +4,000, −6,000, −4,000 cents: exact output must use two transfers, with stable UUID tie-break.
- A single irreducible zero-sum group of 3 members: exact output uses 2 transfers.
- Six-member mixed group: four share groceries, three share fuel, six share cabin; aggregate before minimizing and compare with the independent oracle.
- Zero balance members are removed without transfer.
- Cabin expense payer outside the allocation subset is credited correctly.
- Attendee contributions are reconciled against cabin expense once. A withdrawing member is not refunded; any amount not covered by an approved cabin policy remains unapplied and blocks closure.
- Eight attendees with $50 commitments toward a $250 cabin produce $400 nominal commitments (seven `$50` receipt events plus one payer booking marker) and one `$250` vendor expense. Candidate balances show seven `$18.75` returns (`$131.25` total); hold finalization/closure until the owner approves contribution-excess treatment.
- A partial transfer payment of 2,500 cents on a 5,000-cent transfer leaves exactly 2,500 outstanding.
- Settlement revision after one confirmed payment and one marked-sent payment preserves both events, reserves the in-flight amount, and issues no duplicate transfer.
- For pre-confirmation cancellation, `coming_rsvp` creates no $50 obligation (though premature/extra receipts may exist); `received_contribution` may already have obligations and receipts, which remain unresolved pending approved disposition. Post-confirmation club cancellation remains unresolved absent approved policy.
- Thirteen nonzero balances use the greedy fallback and show non-optimal warning.

### Property/oracle tests

- Generate safe integer balance vectors with sum zero for n=2..12. Compare the exact transfer count to an independent exhaustive zero-sum set-partition oracle.
- For each generated case, assert all invariants in Section 9 and stable output across repeated calls.
- For n<=8, enumerate small cent vectors and compare the solver's count with exhaustive partitions.
- Exercise maximum operation count at n=12; assert exactly 265,720 candidate transitions and no more than 269,815 counted candidate-plus-subset-sum operations under §2.1.
- Generate expense subsets and payer-outside-subset cases, then assert balances sum zero and transfers settle exactly.
- Fuzz allocations around one-cent remainders, custom percentages, zero allocations, negative input rejection and safe-integer boundary.
- Test deterministic tie behavior when several minimum partitions or transfer pairings are available.
- Test fallback determinism, convergence and <=n−1 transfer bound.

## 11. Certification decision

The recommended 12-nonzero-balance exact cap and fallback above it are precise enough to implement and test, but they change the earlier design's unspecified computational limit. Obtain owner approval before coding Phase 6. The implementation must report the algorithm version and whether exact or fallback ran; administrators must not be shown “minimum transfers” when the fallback ran.
