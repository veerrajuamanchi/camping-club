# Design Document: Accountant Role, Expense Receipts (3-Trip Retention), and Dynamic Expense Splits

**Date:** 2026-10-23  
**Status:** Pending Review / Owner Approval  
**File:** `docs/superpowers/specs/2026-10-23-accountant-role-receipts-dynamic-splits-design.md`

---

## 1. Intent and Context

In the Private Camping Club, one participant typically pays for the cabin booking upfront. Attendees send their $50 deposit directly to that individual externally (e.g., via Zelle or Venmo) and confirm in the WhatsApp group. Previously, only Administrators could mark deposits as verified in the application.

Furthermore, when participants make shared group purchases (firewood, group groceries, permits), they need to attach itemized receipts so attendees can audit shared costs. However, to conserve private storage and maintain privacy, receipts should not be retained indefinitely—only for the last 3 campings, after which they are automatically purged.

Finally, when shared expenses are logged before all members have registered or confirmed, the existing allocation system froze a static snapshot of attendees. The club requires a dynamic "All Attendees" split mode so that any campers who join and are confirmed later are automatically included in the split without manual recalculation.

---

## 2. Goals, Non-Goals, and Anti-Goals

### Goals
1. **Accountant Role:** Introduce a third club role (`accountant`) alongside `member` and `admin`. Administrators can assign this role to any member.
2. **Deposit Verification Authority:** Grant Accountants (and Administrators) the permission to verify member deposits (`verify_deposit` API and UI action on the attendee roster).
3. **Least Privilege:** An Accountant has standard member permissions for all other functions (cannot edit trips, cancel events, invite members, or access administrator settings).
4. **Expense Receipt Upload & Viewer:** Allow expense creators, accountants, and administrators to upload receipt images (JPEG, PNG) or PDFs (up to 5MB) when submitting or editing expenses. Attendees can view/zoom receipts in a modal lightbox.
5. **3-Trip Storage Retention:** Maintain private storage for receipts from only the last 3 campings. Receipts belonging to campings prior to the last 3 are automatically purged.
6. **Dynamic "All Attendees" Expense Splits:** Enable expenses to be marked as `all_attendees` (dynamic). As attendees confirm their attendance, the settlement engine dynamically includes them in the equal allocation of those expenses. When an administrator finalizes the settlement, allocations become immutable.

### Non-Goals
- In-app payment transfer or banking integration (money remains strictly external).
- Permanent storage or archiving of expense receipts.
- WhatsApp automation (receipts and confirmations remain in-app).
- Allowing non-confirmed attendees to view itemized receipts or private financial breakdowns.

### Anti-Goals
- Never expose raw receipt storage paths or public bucket URLs without authentication/authorization.
- Never use floating-point math for expense splitting; retain exact integer-cent deterministic division with canonical UUID tie-breaking.
- Direct client writes to settlement status or allocation tables; all mutations remain transactional server-side functions.

---

## 3. Architecture and Technical Design

### A. Member Roles and Permissions
1. **Database Schema Update:**
   - Update `member_role` check constraint on `members` table: `member_role IN ('member', 'accountant', 'admin')`.
   - Update `list_members` and `update_membership` database functions to allow the `accountant` role.
2. **Deposit Verification Authorization:**
   - In `verify_deposit` database function / edge function: allow execution if caller's role is `admin` OR `accountant`.
   - In frontend:
     - `AdminMembersPage.tsx`: Add `Accountant` option in the Role dropdown (`<option value="accountant">Accountant</option>`).
     - `EventDetailsPage.tsx`: Display the "Verify Deposit" action button for users with role `admin` OR `accountant`.

### B. Expense Receipts & Storage Lifecycle
1. **Private Storage Bucket:**
   - Supabase private storage bucket: `trip-receipts`.
   - RLS Policy on `storage.objects`:
     - Upload: Confirmed attendees of the trip, accountants, and admins.
     - Read/Download: Confirmed attendees of the trip, accountants, and admins.
     - Delete: Admins and system retention jobs.
2. **Receipt Metadata on Expenses:**
   - Add columns to `trip_expenses`:
     - `receipt_storage_path TEXT NULL` (e.g., `trips/{trip_id}/{expense_id}.{ext}`)
     - `receipt_file_name TEXT NULL`
     - `receipt_content_type TEXT NULL`
3. **Receipt Scope & Upload Flow (Builder Call):**
   - Scope is creation-only: receipts are attached during the "Add Shared Expense" flow.
   - Deleting an expense removes its attached receipt object from storage.
4. **Receipt Viewer UI:**
   - `TripFinancialsTab.tsx`:
     - Add file dropzone / input in `Add Shared Expense` modal.
     - Uploads file securely to `trip-receipts` and records metadata.
     - Displays `📄 View Receipt` link on expense rows.
     - Clicking opens a clean modal lightbox with zoom/download for images and PDF viewer.
5. **3-Completed-Trips Retention Policy & Automated Purge (Owner Decision):**
   - Retention Rule: Keep receipts only for the 3 most recent **past completed trips** (status `financially_settled` / `completed`). Upcoming trips and the currently active/draft trips are never purged.
   - When a new camping completes, any completed trip older than the 3 most recent completed trips has its receipt files deleted from storage and metadata cleared. Minimal financial settlement records remain preserved under the club's 12-month ledger audit policy.
   - Implementation: Idempotent maintenance job (`purge_expired_receipts`) invoked on trip completion / finalization.

### C. Dynamic "All Attendees" Expense Splits & Persistence Model
1. **Data Model:**
   - Add `split_mode` column to `trip_expenses`:
     - `'all_attendees'` (default): dynamically includes all members who have RSVP'd Coming.
     - `'custom'`: static subset of explicitly selected members.
   - Historical expenses are backfilled as `'custom'` to preserve existing splits.
2. **Dynamic Split Inclusion Criteria (Owner Decision):**
   - Anyone who has RSVP'd **Coming** (`response = 'coming'`) is included in the dynamic split for `all_attendees` expenses. A verified deposit is not required to be included in shared camp expenses like food and firewood.
3. **Persistence and Computation Model (Builder Call):**
   - In-memory calculation during draft phase: while a trip is active and unfinalized, `get_trip_financials` dynamically computes equal allocations across all members with `response = 'coming'` using `calculateEqualAllocations`.
   - Materialization on finalization: when an administrator executes `admin_finalize_settlement`, the exact computed integer-cent allocations for all `all_attendees` expenses are sealed into `trip_expense_allocations` rows, making the final settlement immutable and audit-proof.
   - Defensive validation: an expense requires at least 1 attendee to be created.
4. **Accountant Role Least Privilege Boundary (Owner Decision & Builder Call):**
   - The Accountant role grants strictly:
     1. Permission to verify member deposits (`verify_deposit`).
     2. Viewing the "Verify Deposit" action in the trip roster (`EventDetailsPage.tsx`).
   - Accountants do NOT gain administrator permissions: they cannot edit trips, cannot cancel events, cannot delete other members' expenses, and cannot finalize settlements. They have standard participant access everywhere else.

---

## 4. UI/UX Specifications

1. **Administrator · Members Page (`AdminMembersPage.tsx`):**
   - Role select dropdown includes: `Member`, `Accountant`, `Administrator`.
   - Displays clear badge: `ACCOUNTANT` (emerald green badge).
2. **Event Details Attendee Roster (`EventDetailsPage.tsx`):**
   - If user is `admin` or `accountant`:
     - Displays `[Verify Deposit]` button beside attendees with deposit status `submitted_by_member` or `unpaid`.
     - Clicking executes `verify_deposit` and updates badge to `Verified`.
   - If user is standard `member`:
     - Displays read-only badges (`Deposit Verified`, `Deposit Sent`, or `Unpaid`).
3. **Trip Financials Tab (`TripFinancialsTab.tsx`):**
   - **Add Expense Modal:**
     - Split Type selector:
       - **All Attendees (Dynamic)** [Pre-selected default]: Displays live helper text: *"Splits equally among all confirmed attendees (currently X campers = $Y.YY/person). New attendees who join later will automatically be included."*
       - **Custom Subset**: Expands checkbox list of individual campers for selective splits.
     - Receipt Upload:
       - Drag & drop or file browse input (JPEG, PNG, PDF up to 5MB).
       - File preview with file name and size.
       - Clear retention badge: *"Kept for the last 3 campings, then automatically purged."*
   - **Expense Card:**
     - Shows `📄 View Receipt (filename)` if attached.
     - Clicking opens the Receipt Viewer Modal with image zoom and close button.

---

## 5. Security and Compliance Guardrails

- **Integer Cents Only:** All dynamic splits strictly adhere to `calculateEqualAllocations` integer-cent distribution with canonical UUID tie-breaking; sum of allocations always exactly equals expense amount.
- **Supabase Storage Isolation:** Bucket is private; signed URLs or authenticated RLS endpoints with short expirations are used for viewing.
- **Role Enforcement:** Server-side functions verify `auth.uid()` active membership role from the database—never trust client claims.
- **Auditing:** All deposit verifications record `verified_by_member_id` and timestamp.

---

## 6. Testing Strategy

1. **Unit Tests:**
   - `settlementEngine.test.ts`: Verify dynamic equal allocations recalculate correctly when attendee count grows from 4 to 5, preserving exact cent totals without rounding discrepancies.
   - Dynamic vs custom split logic unit tests.
2. **Component Tests:**
   - `AdminMembersPage.test.tsx`: Test assigning `accountant` role and rendering accountant badges.
   - `EventDetailsPage.test.tsx`: Test that users with role `accountant` see and can click "Verify Deposit", while standard `member` cannot.
   - `TripFinancialsTab.test.tsx`: Test dynamic split mode toggle, receipt file upload handling, and receipt viewer modal.
3. **End-to-End Browser Tests (`test:e2e`):**
   - Role verification in browser on Desktop Chromium, iPhone WebKit, and Android Chromium.
   - Adding dynamic expense, confirming late camper, verifying split updates across reloads.
   - Uploading receipt and opening receipt preview modal.
