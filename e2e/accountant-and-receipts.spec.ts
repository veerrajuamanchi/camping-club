import { test, expect, type Page } from "@playwright/test";
import crypto from "node:crypto";
import {
  createSyntheticUser,
  cleanupSyntheticUsers,
  supabaseAdmin,
  type TestUser,
} from "./helpers/supabase-admin";
import { authenticateSession } from "./helpers/auth";

test.describe("Accountant Role, Dynamic Expense Splits & Receipts", () => {
  const createdTripIds: string[] = [];
  const createdUsers: TestUser[] = [];
  const createdStoragePaths: string[] = [];

  test.beforeAll(async () => {
    // Ensure club timezone is configured
    await supabaseAdmin
      .from("club_configuration")
      .update({ club_timezone: "America/Los_Angeles" })
      .eq("singleton", true);
  });

  test.afterAll(async () => {
    // Clean up created storage objects
    if (createdStoragePaths.length > 0) {
      try {
        await supabaseAdmin.storage.from("trip-receipts").remove(createdStoragePaths);
      } catch {
        // ignore
      }
    }

    // Clean up trips
    for (const tripId of createdTripIds) {
      try {
        await supabaseAdmin.from("trip_expenses").delete().eq("trip_id", tripId);
        await supabaseAdmin.from("trip_rsvps").delete().eq("trip_id", tripId);
        await supabaseAdmin.from("trip_rule_acknowledgments").delete().eq("trip_id", tripId);
        await supabaseAdmin.from("trip_rule_bundles").delete().eq("trip_id", tripId);
        await supabaseAdmin.from("camping_trips").delete().eq("id", tripId);
      } catch {
        // ignore
      }
    }

    // Clean up synthetic users
    await cleanupSyntheticUsers(createdUsers);
  });

  async function assertNoHorizontalOverflow(page: Page, contextName: string) {
    const overflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    expect(overflow, `Page horizontally overflows viewport at ${contextName}`).toBe(false);
  }

  function checkDb<T>(res: { error: any; data: T }): T {
    if (res.error) throw new Error(`Database error: ${JSON.stringify(res.error)}`);
    return res.data;
  }

  async function addComingRsvp(tripId: string, memberId: string, depositStatus: string, actorId: string) {
    await supabaseAdmin.rpc("phase2_refresh_open_rule_bundles", {
      p_actor_id: actorId,
      p_trip_ids: [tripId],
    });

    const { data: bundle } = await supabaseAdmin
      .from("trip_rule_bundles")
      .select("id, content_hash")
      .eq("trip_id", tripId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    if (!bundle) throw new Error("Rule bundle creation failed");

    const ackId = crypto.randomUUID();
    checkDb(
      await supabaseAdmin.from("trip_rule_acknowledgments").insert({
        id: ackId,
        trip_id: tripId,
        member_id: memberId,
        bundle_id: bundle.id,
        content_hash: bundle.content_hash,
        statement_version: "coming-v1",
        request_id: crypto.randomUUID(),
      })
    );

    checkDb(
      await supabaseAdmin.from("trip_rsvps").insert({
        trip_id: tripId,
        member_id: memberId,
        response: "coming",
        rule_acknowledgment_id: ackId,
        deposit_status: depositStatus,
      })
    );
  }

  test("admin assigns accountant role and accountant verifies attendee deposit", async ({
    page,
    browser,
  }, testInfo) => {
    test.setTimeout(180_000);
    const suffix = `${Math.random().toString(36).slice(2, 8)}-${testInfo.project.name.toLowerCase().replace(/[^a-z0-9]/g, "")}`;

    // 1. Create synthetic users
    const adminUser = await createSyntheticUser({
      role: "admin",
      displayName: `QA Lead (Admin) - ${suffix}`,
      emailPrefix: `admin-acc-${suffix}`,
    });
    const candidateUser = await createSyntheticUser({
      role: "member",
      displayName: `Accountant Candidate (Alex) - ${suffix}`,
      emailPrefix: `cand-acc-${suffix}`,
    });
    const attendeeUser = await createSyntheticUser({
      role: "member",
      displayName: `Camper Bailey (Deposit Test) - ${suffix}`,
      emailPrefix: `camper-dep-${suffix}`,
    });
    createdUsers.push(adminUser, candidateUser, attendeeUser);

    // 2. Create test trip with attendee RSVP
    const tripId = crypto.randomUUID();
    createdTripIds.push(tripId);

    const { data: campsite } = await supabaseAdmin
      .from("campsites")
      .select("id")
      .eq("active", true)
      .limit(1)
      .single();
    if (!campsite) throw new Error("No active campsite found");

    const tripTitle = `Autumn Forest Gathering (High-Sierra) - ${suffix}?trip=deposit-qa`;
    checkDb(
      await supabaseAdmin.from("camping_trips").insert({
        id: tripId,
        title: tripTitle,
        month_key: "2027-10-01",
        rotation_position: 1,
        suggested_campsite_id: campsite.id,
        selected_campsite_id: campsite.id,
        starts_on: "2027-10-15",
        ends_on: "2027-10-17",
        poll_deadline_at: new Date(Date.now() + 86400000 * 7).toISOString(),
        club_timezone_snapshot: "America/Los_Angeles",
        poll_status: "open",
        event_status: "tentative",
        max_capacity: 10,
      })
    );

    // Attendee has RSVP'd coming and deposit is submitted
    await addComingRsvp(tripId, attendeeUser.memberId, "submitted_by_member", adminUser.memberId);

    // -------------------------------------------------------------------------
    // Phase 1: Admin logs in, navigates to Admin Members page, assigns Accountant role
    // -------------------------------------------------------------------------
    await authenticateSession(page, adminUser);
    await page.goto("/admin/members");
    await page.waitForLoadState("networkidle");
    await assertNoHorizontalOverflow(page, "admin-members-initial");

    // Locate candidate's member row
    const candidateRow = page.locator(".member-row", { hasText: candidateUser.displayName });
    await expect(candidateRow).toBeVisible();

    // Verify initial role is member
    const roleSelect = candidateRow.getByLabel("Role");
    await expect(roleSelect).toHaveValue("member");

    // Assign 'Accountant' role
    await roleSelect.selectOption("accountant");

    // Verify status notice
    await expect(page.getByRole("status")).toHaveText(
      `Role updated: ${candidateUser.displayName} is now an Accountant. Change recorded in audit log.`
    );

    // Verify badge updates to accountant
    await expect(candidateRow.locator(".badge-pill")).toHaveText(/accountant/i);

    // Verify reload persistence in PostgreSQL
    await page.reload();
    await page.waitForLoadState("networkidle");
    const reloadedRow = page.locator(".member-row", { hasText: candidateUser.displayName });
    await expect(reloadedRow.getByLabel("Role")).toHaveValue("accountant");
    await expect(reloadedRow.locator(".badge-pill")).toHaveText(/accountant/i);

    const { data: dbProfile } = await supabaseAdmin
      .from("member_profiles")
      .select("member_role")
      .eq("member_id", candidateUser.memberId)
      .single();
    expect(dbProfile?.member_role).toBe("accountant");

    // -------------------------------------------------------------------------
    // Phase 2: Sign in as Accountant, navigate to Event Details page
    // -------------------------------------------------------------------------
    const accountantContext = await browser.newContext(testInfo.project.use);
    const accountantPage = await accountantContext.newPage();

    try {
      await authenticateSession(accountantPage, candidateUser);
      await accountantPage.goto(`/trips/${tripId}`);
      await accountantPage.waitForLoadState("networkidle");
      await assertNoHorizontalOverflow(accountantPage, "accountant-event-details");

      // Verify attendee chip shows pending deposit
      const attendeeChip = accountantPage.locator(".attendee-chip", { hasText: attendeeUser.displayName });
      await expect(attendeeChip).toBeVisible();
      await expect(attendeeChip.getByText(/Submitted ⏳/)).toBeVisible();

      // Verify 'Verify Deposit' button is visible on attendee roster
      const verifyDepositBtn = attendeeChip.locator(".btn-verify-deposit");
      await expect(verifyDepositBtn).toBeVisible();
      await expect(verifyDepositBtn).toHaveText("Verify Deposit");

      // Click 'Verify Deposit', verify status updates to verified
      await verifyDepositBtn.click();

      // Status updates to verified ($50 Paid ✓)
      await expect(attendeeChip.getByText(/Paid ✓/)).toBeVisible();
      await expect(attendeeChip.locator(".btn-verify-deposit")).toHaveCount(0);

      // Verify persistence across reload
      await accountantPage.reload();
      await accountantPage.waitForLoadState("networkidle");
      const reloadedAttendeeChip = accountantPage.locator(".attendee-chip", { hasText: attendeeUser.displayName });
      await expect(reloadedAttendeeChip.getByText(/Paid ✓/)).toBeVisible();
      await expect(reloadedAttendeeChip.locator(".btn-verify-deposit")).toHaveCount(0);

      // Verify database persistence
      const { data: dbRsvp } = await supabaseAdmin
        .from("trip_rsvps")
        .select("deposit_status, deposit_confirmed_by")
        .eq("trip_id", tripId)
        .eq("member_id", attendeeUser.memberId)
        .single();
      expect(dbRsvp?.deposit_status).toBe("confirmed_by_admin");
      expect(dbRsvp?.deposit_confirmed_by).toBe(candidateUser.memberId);

      // -----------------------------------------------------------------------
      // Phase 3: Verify Accountant CANNOT see Admin edit event or configure buttons
      // -----------------------------------------------------------------------
      await expect(accountantPage.getByRole("button", { name: "Edit Event" })).toHaveCount(0);
      await expect(accountantPage.getByRole("button", { name: "Configure Trip" })).toHaveCount(0);
      await expect(accountantPage.getByRole("button", { name: "✓ Confirm Trip" })).toHaveCount(0);

      // Accountant cannot access admin route /admin/members
      await accountantPage.goto("/admin/members");
      await accountantPage.waitForLoadState("networkidle");
      await expect(accountantPage.getByText(/Administrator access is required/i)).toBeVisible();
    } finally {
      await accountantContext.close();
    }
  });

  test("creates dynamic expense, confirms late attendee, verifies split reallocates across reload", async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    const suffix = `${Math.random().toString(36).slice(2, 8)}-${testInfo.project.name.toLowerCase().replace(/[^a-z0-9]/g, "")}`;

    // 1. Create admin user and 4 member attendees
    const adminUser = await createSyntheticUser({
      role: "admin",
      displayName: `Admin Payer (Alice) - ${suffix}`,
      emailPrefix: `admin-pay-${suffix}`,
    });
    const attendee2 = await createSyntheticUser({
      role: "member",
      displayName: `Camper Two (Bob) - ${suffix}`,
      emailPrefix: `c2-${suffix}`,
    });
    const attendee3 = await createSyntheticUser({
      role: "member",
      displayName: `Camper Three (Charlie) - ${suffix}`,
      emailPrefix: `c3-${suffix}`,
    });
    const attendee4 = await createSyntheticUser({
      role: "member",
      displayName: `Camper Four (Diana) - ${suffix}`,
      emailPrefix: `c4-${suffix}`,
    });
    const attendee5 = await createSyntheticUser({
      role: "member",
      displayName: `Camper Five (Late Joiner Evan) - ${suffix}`,
      emailPrefix: `c5-${suffix}`,
    });
    createdUsers.push(adminUser, attendee2, attendee3, attendee4, attendee5);

    // 2. Create trip with initial 4 attendees
    const tripId = crypto.randomUUID();
    createdTripIds.push(tripId);

    const { data: campsite } = await supabaseAdmin
      .from("campsites")
      .select("id")
      .eq("active", true)
      .limit(1)
      .single();
    if (!campsite) throw new Error("No active campsite found");

    const tripTitle = `High Sierra Dynamic Split Expedition - ${suffix}?split=dyn-test`;
    checkDb(
      await supabaseAdmin.from("camping_trips").insert({
        id: tripId,
        title: tripTitle,
        month_key: "2027-11-01",
        rotation_position: 2,
        suggested_campsite_id: campsite.id,
        selected_campsite_id: campsite.id,
        starts_on: "2027-11-12",
        ends_on: "2027-11-14",
        poll_deadline_at: new Date(Date.now() + 86400000 * 7).toISOString(),
        club_timezone_snapshot: "America/Los_Angeles",
        poll_status: "closed",
        event_status: "confirmed",
        max_capacity: 10,
      })
    );

    // 4 initial attendees RSVP'd coming
    await addComingRsvp(tripId, adminUser.memberId, "exempt", adminUser.memberId);
    await addComingRsvp(tripId, attendee2.memberId, "confirmed_by_admin", adminUser.memberId);
    await addComingRsvp(tripId, attendee3.memberId, "confirmed_by_admin", adminUser.memberId);
    await addComingRsvp(tripId, attendee4.memberId, "confirmed_by_admin", adminUser.memberId);

    // -------------------------------------------------------------------------
    // 3. Admin logs in and navigates to Trip Financials tab
    // -------------------------------------------------------------------------
    await authenticateSession(page, adminUser);
    await page.goto(`/trips/${tripId}?tab=financials`);
    await page.waitForLoadState("networkidle");
    await assertNoHorizontalOverflow(page, "financials-tab-initial");

    // -------------------------------------------------------------------------
    // 4. Add shared expense ($60.00) with 'All Attendees (Dynamic)' split and attach receipt
    // -------------------------------------------------------------------------
    await page.getByRole("button", { name: "+ Add Shared Expense" }).click();
    const expenseModal = page.locator(".modal-card");
    await expect(expenseModal).toBeVisible();
    await assertNoHorizontalOverflow(page, "add-expense-modal");

    // Verify 'All Attendees (Dynamic)' is selected by default
    const dynamicRadio = expenseModal.getByRole("radio", { name: /All Attendees \(Dynamic\)/i });
    await expect(dynamicRadio).toBeChecked();

    // Verify retention notice is displayed
    await expect(expenseModal.getByText(/Kept for last 3 campings, then auto-deleted/i)).toBeVisible();

    // Fill form fields with realistic formatted data
    const expenseDesc = `Dutch Oven Feast Supplies (Spices & Charcoal) - ${suffix}`;
    await expenseModal.getByLabel("Description").fill(expenseDesc);
    await expenseModal.getByLabel("Amount ($ USD)").fill("60.00");

    // Attach test receipt file
    const receiptFileName = `receipt-${suffix}.jpg`;
    const receiptInput = expenseModal.locator('[data-testid="receipt-file-input"]');
    await receiptInput.setInputFiles({
      name: receiptFileName,
      mimeType: "image/jpeg",
      buffer: Buffer.from("simulated receipt image file content for end-to-end verification"),
    });

    // Verify attached file indicator is visible
    await expect(expenseModal.getByText(new RegExp(receiptFileName))).toBeVisible();

    // Submit expense form
    await expenseModal.getByRole("button", { name: "Save Expense" }).click();
    await expect(expenseModal).toBeHidden();

    // Track storage path for cleanup
    const { data: createdExp } = await supabaseAdmin
      .from("trip_expenses")
      .select("receipt_storage_path")
      .eq("trip_id", tripId)
      .eq("description", expenseDesc)
      .single();
    if (createdExp?.receipt_storage_path) {
      createdStoragePaths.push(createdExp.receipt_storage_path);
    }

    // -------------------------------------------------------------------------
    // 5. Verify receipt link is rendered and opens receipt modal
    // -------------------------------------------------------------------------
    const viewReceiptBtn = page.getByRole("button", { name: "📄 View Receipt" });
    await expect(viewReceiptBtn).toBeVisible();
    await viewReceiptBtn.click();

    const receiptModal = page.getByRole("dialog", { name: "Receipt Preview" });
    await expect(receiptModal).toBeVisible();
    await expect(receiptModal.getByText(new RegExp(receiptFileName))).toBeVisible();
    await assertNoHorizontalOverflow(page, "receipt-preview-modal");

    // Close receipt modal
    await receiptModal.getByRole("button", { name: "Close" }).click();
    await expect(receiptModal).toBeHidden();

    // -------------------------------------------------------------------------
    // 6. Verify initial split across 4 attendees ($15.00 each)
    // -------------------------------------------------------------------------
    // In ledger: Split among 4 members
    await expect(page.getByText("Split among 4 members")).toBeVisible();

    // In Member Balances table: each attendee's Fair Share is $15.00
    const balanceTable = page.locator("table", { hasText: "Fair Share" });
    await expect(balanceTable).toBeVisible();
    await expect(balanceTable.getByText("$15.00", { exact: true })).toHaveCount(4);
    for (const row of await balanceTable.locator("tbody tr").all()) {
      await expect(row.locator("td").nth(2)).toHaveText("$15.00");
    }

    // -------------------------------------------------------------------------
    // 7. Confirm 5th attendee on trip (late joiner)
    // -------------------------------------------------------------------------
    await addComingRsvp(tripId, attendee5.memberId, "unpaid", adminUser.memberId);

    // -------------------------------------------------------------------------
    // 8. Reload page (page.reload())
    // -------------------------------------------------------------------------
    await page.reload();
    await page.waitForLoadState("networkidle");
    await assertNoHorizontalOverflow(page, "financials-reloaded-5-attendees");

    // -------------------------------------------------------------------------
    // 9. Verify split automatically recalculated to 5 attendees ($12.00 each) intact
    // -------------------------------------------------------------------------
    // In ledger: Split among 5 members
    await expect(page.getByText("Split among 5 members")).toBeVisible();

    // In Member Balances table: each attendee's Fair Share is now $12.00
    const reloadedBalanceTable = page.locator("table", { hasText: "Fair Share" });
    await expect(reloadedBalanceTable.getByText("$12.00", { exact: true })).toHaveCount(5);
    await expect(reloadedBalanceTable.getByText("$15.00", { exact: true })).toHaveCount(0);
    for (const row of await reloadedBalanceTable.locator("tbody tr").all()) {
      await expect(row.locator("td").nth(2)).toHaveText("$12.00");
    }

    // Direct PostgreSQL validation: split_mode, receipt metadata, integer-cent conservation
    const { data: dbExpense } = await supabaseAdmin
      .from("trip_expenses")
      .select("split_mode, amount_cents, receipt_file_name, receipt_storage_path")
      .eq("trip_id", tripId)
      .eq("description", expenseDesc)
      .single();
    expect(dbExpense?.split_mode).toBe("all_attendees");
    expect(dbExpense?.amount_cents).toBe(6000);
    expect(dbExpense?.receipt_file_name).toBe(receiptFileName);
    expect(dbExpense?.receipt_storage_path).toBeTruthy();
  });

  test("mobile viewports have zero horizontal overflow and accessible touch targets", async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const suffix = `${Math.random().toString(36).slice(2, 8)}-${testInfo.project.name.toLowerCase().replace(/[^a-z0-9]/g, "")}`;

    const adminUser = await createSyntheticUser({
      role: "admin",
      displayName: `Responsive Lead - ${suffix}`,
      emailPrefix: `resp-${suffix}`,
    });
    createdUsers.push(adminUser);

    await authenticateSession(page, adminUser);

    // Verify Admin Members page viewport and touch targets
    await page.goto("/admin/members");
    await page.waitForLoadState("networkidle");
    await assertNoHorizontalOverflow(page, "mobile-admin-members");

    // Check touch targets on member role selects
    const roleSelects = page.locator("select");
    const count = await roleSelects.count();
    if (count > 0) {
      const box = await roleSelects.first().boundingBox();
      expect(box, "Role select bounding box exists").toBeTruthy();
      expect(box!.height, "Select target height is accessible").toBeGreaterThanOrEqual(28);
    }

    // Verify Home Calendar responsive layout
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await assertNoHorizontalOverflow(page, "mobile-home-calendar");
  });

  test("database logic: purge_expired_receipts purges receipts older than 3 completed trips while preserving recent and upcoming", async () => {
    const { data: campsite } = await supabaseAdmin
      .from("campsites")
      .select("id")
      .eq("active", true)
      .limit(1)
      .single();
    if (!campsite) throw new Error("No active campsite found");

    const t1 = crypto.randomUUID();
    const t2 = crypto.randomUUID();
    const t3 = crypto.randomUUID();
    const t4 = crypto.randomUUID();
    const tUpcoming = crypto.randomUUID();
    createdTripIds.push(t1, t2, t3, t4, tUpcoming);

    const testAdmin = await createSyntheticUser({
      role: "admin",
      displayName: "Purge Test Admin",
      emailPrefix: "purge-admin",
    });
    createdUsers.push(testAdmin);

    // Insert 4 completed trips:
    // t1 (2026-01) -> oldest completed, beyond top 3 -> MUST BE PURGED
    // t2 (2026-02) -> retained (top 3)
    // t3 (2026-03) -> retained (top 3)
    // t4 (2026-04) -> newest completed -> retained (top 3)
    // tUpcoming (2026-12) -> upcoming -> retained
    checkDb(
      await supabaseAdmin.from("camping_trips").insert([
        {
          id: t1,
          title: "T1 Jan Expired",
          month_key: "2026-01-01",
          starts_on: "2026-01-10",
          ends_on: "2026-01-12",
          trip_status: "completed",
          event_status: "confirmed",
          poll_status: "closed",
          suggested_campsite_id: campsite.id,
          selected_campsite_id: campsite.id,
          rotation_position: 1,
          club_timezone_snapshot: "America/Los_Angeles",
        },
        {
          id: t2,
          title: "T2 Feb Retained",
          month_key: "2026-02-01",
          starts_on: "2026-02-10",
          ends_on: "2026-02-12",
          trip_status: "completed",
          event_status: "confirmed",
          poll_status: "closed",
          suggested_campsite_id: campsite.id,
          selected_campsite_id: campsite.id,
          rotation_position: 2,
          club_timezone_snapshot: "America/Los_Angeles",
        },
        {
          id: t3,
          title: "T3 Mar Retained",
          month_key: "2026-03-01",
          starts_on: "2026-03-10",
          ends_on: "2026-03-12",
          trip_status: "financially_settled",
          event_status: "confirmed",
          poll_status: "closed",
          suggested_campsite_id: campsite.id,
          selected_campsite_id: campsite.id,
          rotation_position: 3,
          club_timezone_snapshot: "America/Los_Angeles",
        },
        {
          id: t4,
          title: "T4 Apr Retained",
          month_key: "2026-04-01",
          starts_on: "2026-04-10",
          ends_on: "2026-04-12",
          trip_status: "completed",
          event_status: "confirmed",
          poll_status: "closed",
          suggested_campsite_id: campsite.id,
          selected_campsite_id: campsite.id,
          rotation_position: 4,
          club_timezone_snapshot: "America/Los_Angeles",
        },
        {
          id: tUpcoming,
          title: "T Upcoming Retained",
          month_key: "2026-12-01",
          starts_on: "2026-12-10",
          ends_on: "2026-12-12",
          poll_deadline_at: new Date(Date.now() + 86400000 * 7).toISOString(),
          trip_status: "rsvp_open",
          event_status: "tentative",
          poll_status: "open",
          suggested_campsite_id: campsite.id,
          selected_campsite_id: campsite.id,
          rotation_position: 5,
          club_timezone_snapshot: "America/Los_Angeles",
        },
      ])
    );

    const pathT1 = `trips/${t1}/receipt_t1.jpg`;
    const pathT4 = `trips/${t4}/receipt_t4.jpg`;
    const pathUp = `trips/${tUpcoming}/receipt_up.jpg`;
    createdStoragePaths.push(pathT1, pathT4, pathUp);

    // Upload receipt objects to storage
    await supabaseAdmin.storage.from("trip-receipts").upload(pathT1, Buffer.from("receipt t1"), { contentType: "image/jpeg" });
    await supabaseAdmin.storage.from("trip-receipts").upload(pathT4, Buffer.from("receipt t4"), { contentType: "image/jpeg" });
    await supabaseAdmin.storage.from("trip-receipts").upload(pathUp, Buffer.from("receipt up"), { contentType: "image/jpeg" });

    // Insert expenses referencing receipts
    checkDb(
      await supabaseAdmin.from("trip_expenses").insert([
        {
          trip_id: t1,
          expense_type: "shared_receipt",
          payer_member_id: testAdmin.memberId,
          amount_cents: 2000,
          description: "T1 Old Expense",
          receipt_storage_path: pathT1,
          receipt_file_name: "receipt_t1.jpg",
        },
        {
          trip_id: t4,
          expense_type: "shared_receipt",
          payer_member_id: testAdmin.memberId,
          amount_cents: 3000,
          description: "T4 Recent Expense",
          receipt_storage_path: pathT4,
          receipt_file_name: "receipt_t4.jpg",
        },
        {
          trip_id: tUpcoming,
          expense_type: "shared_receipt",
          payer_member_id: testAdmin.memberId,
          amount_cents: 4000,
          description: "Upcoming Expense",
          receipt_storage_path: pathUp,
          receipt_file_name: "receipt_up.jpg",
        },
      ])
    );

    // Execute purge RPC via service_role
    const { data: purgedData, error: purgeError } = await supabaseAdmin.rpc("purge_expired_receipts");
    expect(purgeError).toBeNull();

    // Verify expired trip receipt was purged from trip_expenses
    const { data: expT1 } = await supabaseAdmin.from("trip_expenses").select("receipt_storage_path").eq("trip_id", t1).single();
    expect(expT1?.receipt_storage_path).toBeNull();

    // Verify recent completed trip receipt was preserved
    const { data: expT4 } = await supabaseAdmin.from("trip_expenses").select("receipt_storage_path").eq("trip_id", t4).single();
    expect(expT4?.receipt_storage_path).toBe(pathT4);

    // Verify upcoming trip receipt was preserved
    const { data: expUp } = await supabaseAdmin.from("trip_expenses").select("receipt_storage_path").eq("trip_id", tUpcoming).single();
    expect(expUp?.receipt_storage_path).toBe(pathUp);

    // Verify storage.objects: pathT1 is deleted, pathT4 and pathUp exist
    const { data: filesT1 } = await supabaseAdmin.storage.from("trip-receipts").list(`trips/${t1}`);
    expect(filesT1?.find((f) => f.name === "receipt_t1.jpg")).toBeUndefined();

    const { data: filesT4 } = await supabaseAdmin.storage.from("trip-receipts").list(`trips/${t4}`);
    expect(filesT4?.find((f) => f.name === "receipt_t4.jpg")).toBeDefined();

    const { data: filesUp } = await supabaseAdmin.storage.from("trip-receipts").list(`trips/${tUpcoming}`);
    expect(filesUp?.find((f) => f.name === "receipt_up.jpg")).toBeDefined();
  });
});
