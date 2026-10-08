# Cabin and Settlement Worked Examples

**Status:** Reconciliation evidence for the planning model. Figures use integer cents. These examples distinguish owner-approved facts from proposed dispositions; no unresolved refund, surplus, or cancellation policy is activated by an example.
**Related:** [Settlement Engine](SETTLEMENT_ENGINE_SPEC.md), [Database Schema](DATABASE_SCHEMA.md), [Test Strategy](TEST_STRATEGY.md)

## Accounting conventions

- Signed member balance: positive = the member is owed money; negative = the member owes money.
- A vendor expense posts the actual payer's full payment as a positive credit and each approved allocation as a negative debit. Allocation cents total the vendor amount exactly.
- A completed external contribution/settlement payment from B to recipient A changes B by `+amount` and A by `−amount`; `sent` alone changes no confirmed-cash balance. Every source is linked once to immutable event(s).
- Cabin receipt events reimburse/advance cabin cost; they are not expenses. The cabin vendor payment is recorded once. The attending cabin payer's own $50 commitment is a non-posting booking-coverage marker linked to the vendor payment, not an eighth/ninth cash payment.
- Any trip-level amount held for an unapproved refund/credit/disposition remains in a separate unapplied control balance. It is not spendable and blocks settlement close.

## 1. Four attendees, $240 cabin invoice, one cabin payer, three $50 receipts

Assume A paid the vendor and attends. B/C/D each owe and pay $50 to A; A's own $50 commitment is covered by the vendor booking. Cabin cost is allocated equally at $60 each.

| Record | Amount | Posting / status |
| --- | ---: | --- |
| Vendor payment A → cabin provider | $240.00 | One immutable vendor payment fact; expense payer credit A `+$240.00`. |
| Cabin cost allocation A/B/C/D | $60.00 each | Allocation debits `−$60` each; totals $240.00 exactly. |
| A's $50 commitment | $50.00 | `booking_coverage_acknowledged` marker; non-posting, no self-payment. |
| B → A contribution | $50.00 | `sent` then recipient-confirmed `received`; B `+$50`, A `−$50`. |
| C → A contribution | $50.00 | Same; C `+$50`, A `−$50`. |
| D → A contribution | $50.00 | Same; D `+$50`, A `−$50`. |

After invoice allocations, balances are A `+$180`, B/C/D `−$60` each. After the three confirmed contribution receipts: A `+$30`, B/C/D `−$10` each. Thus candidate transfers are B→A `$10`, C→A `$10`, D→A `$10` (total `$30`). Those transfers settle the cabin invoice exactly: A paid `$240`, and receives `$150` contributions plus `$30` settlement; A's own allocated share is `$60`; each other attendee pays `$50 + $10 = $60`.

**Reconciliation:** vendor expense `$240` = four shares `$240`; external contributions `$150` are included in member payment history and are not added to expense; remaining settlement `$30`; no contribution or expense is counted twice. Remaining obligations after the three settlement transfers: `$0` (all four $50 commitments accounted for; A by booking marker).

## 2. Eight attendees, $250 cabin invoice, eight $50 commitments

Assume A is the attendee who paid the vendor. A's $50 commitment is covered by the vendor payment marker. B–H each send and A confirms $50, for seven actual external receipts totaling `$350`. The invoice is shared equally: `$31.25` per attendee.

| Record | Amount | Posting / status |
| --- | ---: | --- |
| Vendor payment A → provider | $250.00 | One vendor expense/payment fact. |
| Eight cost allocations | $31.25 each | Total `$250.00`. |
| A commitment | $50.00 | Non-posting booking coverage marker. |
| B–H contribution receipts | $350.00 | Seven immutable received events, `$50.00` each. |

Before contribution receipts, balances are A `+$218.75`, B–H `−$31.25` each. After the seven confirmed receipts, balances are A `−$131.25`; B–H `+$18.75` each. Exact balancing candidate transfers are A→B, C, D, E, F, G, H `$18.75` each, total `$131.25`. After those transfers, each member's net cabin cost is `$31.25`.

The eight commitments total `$400` nominally, but only `$350` is external cash because A's commitment is covered inside A's `$250` vendor payment. The `$131.25` candidate repayment includes the other seven members' overpayment above their `$31.25` shares and A's own `$31.25` cost. The records still reconcile to the `$250` invoice exactly; there is no extra `$400` expense.

**Policy gate:** whether to execute this repayment or instead hold/credit contribution excess is not owner-approved. Record the candidate balances/transfers for review, but do not finalize/close while the excess disposition is unresolved. No amount may be reclassified to food/travel.

## 3. Post-confirmation withdrawal after payment

Illustration only: A paid `$240`; four people initially committed. B/C/D each paid `$50`; D later withdraws. The accepted rule says D's $50 is non-refundable for a member-initiated withdrawal. The *application* of that money to remaining attendees' cabin shares is not approved, so the numbers below show a proposed group-credit treatment and remain gated.

| Record | Amount | Posting / status |
| --- | ---: | --- |
| Vendor payment by A | $240.00 | A payer credit `+$240`. |
| D contribution received | $50.00 | Immutable; no refund obligation on member withdrawal. |
| B/C contributions received | $100.00 | Immutable, `$50` each. |
| A's commitment marker | $50.00 | Non-posting booking coverage. |
| Proposed group cabin credit from D | $50.00 | Applies only if approved; not another receipt/expense. |
| Remaining attendees' proposed cabin allocations | A `$63.34`, B `$63.33`, C `$63.33` | Total `$190`, plus D's proposed `$50` group credit = `$240`. |

Under that proposed treatment the ledger postings are: vendor payer A `+$240`; allocations A `−$63.34`, B `−$63.33`, C `−$63.33`; cabin contribution fund `−$50` to balance the `$190` attendee allocations against the `$240` vendor cost. D's received payment applies once as A `−$50` / cabin contribution fund `+$50`; B's and C's receipt events each post contributor `+$50` / A `−$50`. The control account nets to zero after the approved application; the member balances are exactly A `+$26.66`, B `−$13.33`, C `−$13.33`, D `$0`. The booking marker for A posts zero.

Under that proposed policy, member balances after B/C payments are A `+$26.66`, B `−$13.33`, C `−$13.33`, D `$0`. Candidate transfers are B→A `$13.33` and C→A `$13.33`. D receives `$0` refund, and D is not allocated cabin expense. A's final net cabin cost is `$63.34`; B/C each pay `$63.33`; D's non-refundable `$50` funds the shared cost.

**Policy gate:** owner approval is required to treat D's non-refundable contribution as a group credit and remove D from allocation while spreading the residual among A/B/C. Without that approval, keep D's receipt unapplied, do not generate those transfers as final instructions, and block settlement closure. Exact cent remainder goes to the lowest stable member UUID (shown as A here solely for illustration).

If that treatment is approved and both candidate transfers are confirmed, the four original `$50` commitments are fully accounted for and no settlement balance remains. Until approval, the `$50` application/control balance and the proposed `$26.66` transfers remain unresolved, not payable instructions.

## 4. Club-initiated cancellation after contributions

Illustration: A paid `$240` to the cabin provider; provider confirms cancellation and returns `$200`, leaving documented non-refundable cost `$40`. B/C/D had each paid A `$50` before cancellation. A's own booking-coverage marker is not cash.

| Record | Amount | Accounting state |
| --- | ---: | --- |
| Vendor payment A → provider | $240.00 | Immutable original cash-out. |
| Provider refund/credit to A | $200.00 | Separate confirmed refund event; net documented provider loss `$40`. |
| B/C/D receipts to A | $150.00 | Three immutable member receipt events. |
| A booking coverage marker | $50.00 | Non-posting marker, not additional money. |
| Net unresolved member contributions | $150.00 | Held as unapplied pending owner policy; not treated as trip expense or spendable funds. |
| Possible difference after $40 provider loss | $110.00 | Arithmetic remainder only; not yet a refund, credit, or club asset. |

**Reconciliation:** provider cash reconciles `$240 − $200 = $40` cost. Member receipts are `$150`; the potential residual after the loss is `$110`. There are no finalized member balances/transfers and no remaining individual amount is assigned because the design does not authorize whether to refund all, retain some against cabin loss, or allocate the loss among participants. Settlement close stays blocked; the trip cancellation and cabin cancellation/refund are distinct events.

The same block applies to insufficient-participation cancellation under `received_contribution`: pre-cutoff receipts may exist and remain unresolved until a specific owner policy is approved. Under `coming_rsvp`, no $50 obligation is due before confirmation, but any premature payment is still held unresolved rather than automatically retained/refunded.

## 5. Partial payment followed by settlement correction

Three members A/B/C share a `$90` grocery expense equally; A paid it. Version 1 allocates `$30` to each and produces A `+$60`, B `−$30`, C `−$30`; transfers B→A `$30`, C→A `$30`.

| Event | V1/V2 accounting |
| --- | --- |
| B sends `$20`, A confirms receipt on V1 transfer | Append sent and received events; B's remaining V1 obligation is `$10`; A has received `$20`. V1 facts/transfer remain immutable. |
| New `$30` fuel expense, C pays; A and C share `$15` each | New expense lines: C `+$30`, A `−$15`, C `−$15`; adds A `−$15`, C `+$15` to raw balances. |
| V2 raw aggregate before old confirmed payment | A `+$45`, B `−$30`, C `−$15` (balances sum zero). |
| Carry confirmed B→A `$20` once into V2 | A `−$20`, B `+$20`; residual V2 balances A `+$25`, B `−$10`, C `−$15`. |
| V2 candidate transfers | B→A `$10`; C→A `$15`; total `$25`. |

V1's original B→A `$30` transfer retains the confirmed `$20` event and a `$10` residual lineage; its unpaid portion is superseded by V2, not deleted. V1 C→A `$30` is unpaid and superseded by V2 C→A `$15`. No party is asked to send the confirmed `$20` again. V2 payments of `$10 + $15` settle its `$25` residual exactly. Remaining obligations after V2 receipts: `$0`; historical V1 sent/received events remain available for the 12-month ledger.

If a payer has marked a partial amount sent but the recipient has not confirmed it, that amount is in-flight: reserve it against re-issuance or block the correction until resolved. Never both count it as received and retain it as an outstanding transfer.

## Required reconciliation assertions

Every worked example is an acceptance fixture. Assert integer-cent totals, source-event uniqueness, `sum(member balances + control-account balances) = 0` where a control account is used, total proposed transfer outflow equals inflow, no self-transfer, payment receipt ≤ sent/obligation amount, no booking marker posting, and no settlement closure with unresolved cancellation/surplus/withdrawal amounts. Expected values are compared with an independently implemented test oracle.
