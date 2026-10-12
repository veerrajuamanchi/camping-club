import { test, expect } from "@playwright/test";
import {
  createSyntheticUser,
  cleanupSyntheticUsers,
  getLatestAuthFromMailpit,
  type TestUser,
  supabaseAdmin,
} from "./helpers/supabase-admin";
import { authenticateSession, loginViaUiOtp } from "./helpers/auth";

test.describe("Authentication and Access Approval Flow", () => {
  let adminUser: TestUser;
  let approvedMember: TestUser;

  test.beforeAll(async () => {
    adminUser = await createSyntheticUser({
      role: "admin",
      displayName: "Membership Admin",
      emailPrefix: "auth-admin",
    });
    approvedMember = await createSyntheticUser({
      role: "member",
      displayName: "Active Camper",
      emailPrefix: "active-camper",
    });
  });

  test.afterAll(async () => {
    await cleanupSyntheticUsers([adminUser, approvedMember]);
  });

  test("approved member signs in using real OTP code delivered to email", async ({ page }) => {
    await page.goto("/signin");
    await expect(page.getByRole("heading", { name: "Sign in to the Camping Club" })).toBeVisible();

    // Submit registered email
    await page.getByLabel("Email address").fill(approvedMember.email);
    await page.getByRole("button", { name: "Sign In" }).click();

    // Verify OTP input displays
    const otpInput = page.getByLabel("Verification code");
    await expect(otpInput).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(approvedMember.email)).toBeVisible();

    // Fetch real OTP or verification credentials from Mailpit
    const authCreds = await getLatestAuthFromMailpit(approvedMember.email);
    expect(authCreds.code || authCreds.verifyUrl).toBeTruthy();

    if (authCreds.code) {
      await otpInput.fill(authCreds.code);
      await page.getByRole("button", { name: "Verify" }).click();
    } else if (authCreds.verifyUrl) {
      await page.goto(authCreds.verifyUrl);
    }

    // Verify user is redirected to calendar/home and session header is rendered
    await page.waitForURL((url) => url.pathname === "/", { timeout: 15_000 });
    await expect(page.getByRole("button", { name: "User menu" })).toBeVisible();
  });

  test("unregistered email displays clear registration prompt", async ({ page }) => {
    await page.goto("/signin");
    const unknownEmail = `unknown-${Date.now()}@example.test`;

    await page.getByLabel("Email address").fill(unknownEmail);
    await page.getByRole("button", { name: "Sign In" }).click();

    // Verify error and suggestion
    await expect(
      page.getByText("This email is not registered. Please register to request access.")
    ).toBeVisible();
    const registerSuggestion = page.getByRole("button", { name: /Go to Registration/i });
    await expect(registerSuggestion).toBeVisible();

    // Clicking it switches form to registration mode
    await registerSuggestion.click();
    await expect(page.getByRole("heading", { name: "Request Club Membership" })).toBeVisible();
  });

  test("new member submits access request and admin approves it in members portal", async ({
    page,
    browser,
  }) => {
    const applicantTimestamp = Date.now();
    const applicantName = `Prospective Camper ${applicantTimestamp}`;
    const applicantEmail = `applicant-${applicantTimestamp}@example.test`;

    // 1. Applicant submits access request
    await page.goto("/signin");
    await page.getByRole("tab", { name: "Register" }).click();
    await expect(page.getByRole("heading", { name: "Request Club Membership" })).toBeVisible();

    await page.getByLabel("Name").fill(applicantName);
    await page.getByLabel("Email address").fill(applicantEmail);
    await page.getByRole("button", { name: "Request Access" }).click();

    // Verify confirmation
    await expect(page.getByRole("heading", { name: "Access request submitted" })).toBeVisible();
    await expect(
      page.getByText("Your request has been sent to the club administrator.")
    ).toBeVisible();

    // 2. Administrator opens admin portal and approves the request
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();

    await authenticateSession(adminPage, adminUser);
    await adminPage.goto("/admin/members");
    await expect(adminPage.getByRole("heading", { name: "Administrator · Members" })).toBeVisible();

    // Locate applicant's request row
    const requestRow = adminPage.locator("li", { hasText: applicantName });
    await expect(requestRow).toBeVisible();
    await expect(requestRow).toContainText(applicantEmail);

    // Click Approve
    await requestRow.getByRole("button", { name: "Approve" }).click();
    await expect(
      adminPage.getByText("Request approved and invitation email sent.")
    ).toBeVisible();

    // Clean up applicant auth/profile records created by approval
    const { data: approvedAuthUser } = await supabaseAdmin.auth.admin.listUsers();
    const createdUser = approvedAuthUser.users?.find(
      (u) => u.email?.toLowerCase() === applicantEmail.toLowerCase()
    );
    if (createdUser) {
      await supabaseAdmin.from("member_profiles").delete().eq("auth_user_id", createdUser.id);
      await supabaseAdmin.auth.admin.deleteUser(createdUser.id);
    }
    await adminContext.close();
  });
});
