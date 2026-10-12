import { expect, type Page } from "@playwright/test";
import { getLatestAuthFromMailpit, type TestUser } from "./supabase-admin";

/**
 * Performs browser-driven login using the real email flow via Mailpit.
 * Supports both direct 6-digit OTP code entry and verification URL.
 */
export async function loginViaUiOtp(page: Page, email: string) {
  await page.goto("/signin");
  await expect(page.getByRole("heading", { name: "Sign in to the Camping Club" })).toBeVisible();

  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Sign In" }).click();

  // Wait for the OTP screen to appear
  const otpInput = page.getByLabel("Verification code");
  await expect(otpInput).toBeVisible({ timeout: 10_000 });

  // Retrieve delivered credentials from Mailpit
  const authCreds = await getLatestAuthFromMailpit(email);

  if (authCreds.code) {
    // Fill the verification code and submit
    await otpInput.fill(authCreds.code);
    await page.getByRole("button", { name: "Verify" }).click();
  } else if (authCreds.verifyUrl) {
    // Navigate via the delivered verification link
    await page.goto(authCreds.verifyUrl);
  } else {
    throw new Error(`Neither OTP code nor verification URL found in email for ${email}`);
  }

  // Wait for user to be redirected to home/calendar
  await page.waitForURL((url) => url.pathname !== "/signin", { timeout: 15_000 });
  await expect(page.getByRole("button", { name: "User menu" })).toBeVisible({ timeout: 15_000 });
}

/**
 * Authenticates the user in the browser using the real email authentication flow.
 */
export async function authenticateSession(page: Page, user: TestUser) {
  await loginViaUiOtp(page, user.email);
}
