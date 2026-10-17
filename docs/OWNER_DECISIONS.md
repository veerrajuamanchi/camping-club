# Owner Decision Record — Private Camping Club Platform

**Status:** Decision register. Every decision below is **pending** unless a dated owner approval is recorded in the final column. OD-03 records the owner’s maintenance instruction on 2026-10-15. Reviewer recommendations and existing design text do not by themselves constitute owner approval.
**Purpose:** Capture the remaining product, financial, algorithm, and operational choices that affect implementation gates. This record supplements [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) and the [consistency remediation report](CONSISTENCY_REMEDIATION_REPORT.md).

## Decisions requiring owner input

| ID | Decision | Options to choose from | Reviewer recommendation (not approved) | Owner decision / approval record | Gate |
| --- | --- | --- | --- | --- | --- |
| OD-01 | What qualifies toward the minimum four? | **A.** Four active Coming RSVPs; collect $50 after confirmation. **B.** Four active Coming RSVPs with a full $50 receipt recorded before cutoff. | A | **Pending** — owner selection and date not recorded. | Phase 2/3; registration must fail closed while unset. |
| OD-02 | If OD-01 selects received contributions, does an attending cabin payer's vendor-payment coverage marker count? | **A.** Count the documented, non-posting booking-coverage marker for that payer. **B.** Require a qualifying received contribution for every counted participant; marker does not qualify. | No recommendation recorded. | **Pending** — owner selection and date not recorded. | Phase 2/3; required only if OD-01 = B. |
| OD-03 | When is a post-confirmation withdrawal effective? | **A.** Immediately when the member requests; notify admin. **B.** Remains pending until an admin approves or rejects it. | B | **Owner-approved option A; recorded 2026-10-15.** Owner explicitly requests members be able to change RSVP before or after confirmation. Show the non-refundable $50 deposit warning for withdrawal within 30 calendar days and explain administrator-coordinated replacement/external reimbursement. No automatic refund, transfer of obligation, or allocation policy is authorized. | Maintenance RSVP slice; admin alerts/lifecycle integration remain subject to Phase 3 certification. |
| OD-04 | Must cabin booking verification delay club trip confirmation? | **A.** No; decide participation at cutoff and track the cabin reservation separately. **B.** Yes; require an admin booking verification before confirming the trip. Also decide whether the legacy `Closed — Pending Decision` label is retained. | A | **Pending** — owner selection and date not recorded. | Phase 2/3. |
| OD-05 | How are contributions above the allocated cabin cost handled? | **A.** Refund the excess to contributors. **B.** Apply it as future club credit. **C.** Leave excess unapplied until an owner-approved, auditable case-by-case disposition policy is applied. | A | **Pending** — owner selection and date not recorded. | Phase 3/6; no close while excess is unresolved. |
| OD-06 | What happens to money received before an insufficient-participation cancellation? | Define disposition for receipts collected under OD-01 B, and separately for premature/extra receipts under OD-01 A. Choices may specify refunds, credits, or another explicitly defined disposition with evidence and reconciliation requirements. | No automated disposition; preserve funds unresolved until selected. | **Pending** — owner selection and date not recorded. | Phase 3; financial close blocked until resolved. |
| OD-07 | How are contributions handled when the club cancels a confirmed trip? | Define how provider refunds, documented non-refundable cabin costs, member contributions, refunds/credits, and any remaining balance reconcile. No automatic forfeiture or refund is assumed. | Return contributions to the extent the provider refunds the cabin payment; apply only documented non-refundable cabin loss under an approved allocation rule; return remaining funds. | **Pending** — reviewer proposal only; owner selection and date not recorded. | Phase 3/6; cancellation close blocked. |
| OD-08 | How is a paid $50 contribution from a member who withdraws applied? | The member-level rule that the contribution is non-refundable on member withdrawal is already owner-approved. Choose whether/when it reduces remaining attendees' cabin allocations, remains unapplied, or follows another defined policy, especially when the amount exceeds the final cabin cost. | Preserve as an unapplied balance until an explicit allocation policy is approved. | **Pending** — approved nonrefund rule is not approval of group allocation or excess treatment. | Phase 3/6; settlement close blocked while unapplied. |
| OD-09 | What exact optimizer ceiling should be certified? | **A.** Exact optimization through 12 nonzero balances; deterministic greedy fallback above 12. **B.** Approve a higher exact ceiling after reviewing operation count/runtime. | A | **Pending** — owner selection and date not recorded. | Phase 6; tests must assert the chosen bound. |
| OD-10 | Should payment-method compatibility break optimizer ties? | **A.** No; minimize transfer count, then use the specified deterministic tie-break. **B.** Yes; collect sender-supported methods and make compatibility a secondary preference. | No recommendation recorded. | **Pending** — owner selection and date not recorded. | Phase 6; do not infer sender capabilities from receiver preference. |
| OD-11 | What lottery evidence and seed-retention approach is required? | **A.** Keep the documented encrypted seed and reproducibility evidence through the operational audit window; preserve first draw and rerun history. **B.** Specify an independent randomness source or a different audit/retention period. | A | **Pending** — owner selection and date not recorded. | Phase 4; lottery cannot be certified until selected. |
| OD-12 | Who owns operations, and which recovery targets/destination are approved? | Name a primary trip administrator, backup trip administrator, backup/export operator, and escalation owner. Approve or revise the proposed RPO ≤24 hours and RTO ≤one business day; approve the encrypted off-site backup destination, access controls, quota, and retention. | Use named primary/backup roles, independent monitoring, manual cabin deadline fallback, and validate the proposed targets with a restore drill. | **Pending** — names, destination, targets, and date not recorded. | Before launch; backup and deadline operations cannot be certified without evidence. |

## Existing owner-approved decisions retained

These are carried forward from prior explicit owner decisions; this register does not reopen them:

- A trip below the configured minimum at the registration cutoff is automatically cancelled and members are emailed. The threshold is four by default; OD-01 determines the count basis.
- Each attendee has a $50 cabin contribution paid externally to the admin-assigned cabin payer. Collection timing and whether a received $50 gates the four-person minimum remain pending under OD-01; neither basis is owner-approved.
- A member-initiated post-confirmation withdrawal does not erase the $50 obligation; a paid contribution is non-refundable to that member. OD-08 concerns only how that money is applied to group cabin accounting.
- Coming signup acknowledges the exact rules shown. Later rule edits do not require a new acknowledgment.
- Minimal finalized settlement records are retained for 12 months; receipts and sensitive payment instructions/identifiers are retained for three months.
- The club creates WhatsApp groups manually; the app does not create groups automatically.
- **Club timezone and existing-deadline changes:** `America/Los_Angeles`, interpreted through IANA timezone rules, is the club timezone. This was explicitly directed by the owner on 2026-10-08. The setting is administrator-managed; a change that affects existing trip deadlines requires explicit administrator confirmation and an audit record. No fixed UTC offset is policy.

## Recording an approval

For each ID, the owner should record the selected option or exact policy text, approval date, and any scope/exception. Until then, the status stays **Pending**. A reviewer recommendation, a default in code, or a blank field is not approval. If a choice is deferred, identify the affected phase and keep that transition disabled or fail-closed until approval.

## Implementation boundary

This record is a planning artifact and does not authorize additional coding or deployment. Existing Phase 1/2 source on `main` is not itself approval for further changes. Follow the current repository approval boundary; later phase gates also require their listed policy decisions and certification evidence.

## Workload maintenance instruction — recorded 2026-10-15

The owner explicitly requests active workload totals, an administrator-determined daily weighted goal (4× given as an example), and no forced additional selections when all eligible tasks are taken. Daily goals are configured per trip and opt-in; this does not impose a new default on existing trips. This instruction does not authorize duplicating a trip-wide driver credit across days, altering money policy, or bypassing the QA-first release boundary.

## Daily responsibility planning — owner approved 2026-10-16

The owner approved the per-date checkbox plan in chat: every actual date requires at least one selected master responsibility to save the responsibility plan. This supersedes automatic weekday/title-based presets for this bounded responsibilities slice. Existing volunteer assignments are retained; removing their duties requires explicit administrator confirmation and excludes those duties from daily workload. This does not require a responsibility plan before RSVP, event creation or confirmation, and does not change financial or trip cancellation policies.

## Final architecture refinements — recorded 2026-10-16

The owner established the baseline architecture with eight targeted refinements:
1. **Driving as Master Responsibility:** Driving is not a special-case workload code mechanism. `driver_workload_credit` is removed from `trip_carpools`. Driving tasks (e.g. Friday Departure Driver, Sunday Return Driver, Round Trip Driver) are configured from the Master Responsibilities library with standard workload weights.
2. **Member Profile & Settlement Display:** Member profile payment methods (Zelle, Venmo, PayPal, Apple Cash) and handles are encrypted at rest; settlement screens display the recipient's preferred method and decrypted handle directly to the payer. The app never moves money.
3. **Trip Commitments Model:** Unified item commitment model across Cooking Gear, Food & Groceries, Supplies, Shelter & Camp Setup, and Safety. All commitments answer: *Who committed to bring it?*
4. **Flexible Food Planning:** Admins may plan food via Item-Based Planning (e.g. *2 Dozen Eggs*) or Grouped Planning (e.g. *Saturday Breakfast Supplies*); the system does not force ingredient-level tracking.
5. **Duty Assignment Modes:** Self-selection is default; at T-48h before trip start, Admin Assignment Mode enables organizers to force-assign, reassign, move, or remove duties to close remaining gaps.
6. **Two-Stage Settlement Lifecycle:** Lifecycle distinguishes `financially_finalized` (expenses and odometers locked, settlement transfers computed) from `financially_settled` (all transfers confirmed received by recipients or admin override). Recipient confirmation progression: `Outstanding` → `Marked Sent` → `Awaiting Confirmation` → `Settled`.
7. **Home Page Preservation:** The event-card-centered landing page is preserved as the primary interface, enhanced with a 5-point Trip Readiness scorecard.
8. **Scope Governance:** Product scope is bounded strictly by the Five Questions (*Am I going? What do I owe? What responsibilities did I commit to? What am I bringing? How am I getting there?*). Chat, guest workflows, ride requests, volunteer scoring, and social features remain strictly out of scope.
