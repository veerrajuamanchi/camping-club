import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { MembershipState } from "./AccessBoundary";
import { SignInPage } from "./SignInPage";

function renderSignIn(
  refresh: () => Promise<MembershipState>,
  overrides?: {
    checkAccess?: (name: string, email: string) => Promise<{ status: "approved_member" }>;
    sendOtp?: (email: string) => Promise<void>;
    verifyOtp?: (email: string, token: string) => Promise<void>;
  },
) {
  const checkAccess = overrides?.checkAccess ?? vi.fn().mockResolvedValue({ status: "approved_member" as const });
  const sendOtp = overrides?.sendOtp ?? vi.fn().mockResolvedValue(undefined);
  const verifyOtp = overrides?.verifyOtp ?? vi.fn().mockResolvedValue(undefined);
  render(
    <MemoryRouter initialEntries={["/signin"]}>
      <Routes>
        <Route
          path="/signin"
          element={
            <SignInPage
              checkAccess={checkAccess}
              sendOtp={sendOtp}
              verifyOtp={verifyOtp}
              refresh={refresh}
            />
          }
        />
        <Route path="/accept-invitation" element={<h1>Complete your profile</h1>} />
        <Route path="/" element={<h1>Trip calendar</h1>} />
      </Routes>
    </MemoryRouter>,
  );
  return { checkAccess, sendOtp, verifyOtp };
}

describe("SignInPage", () => {
  it("sends an invitee with no profile to profile completion after OTP verification", async () => {
    const user = userEvent.setup();
    const { checkAccess, sendOtp, verifyOtp } = renderSignIn(async () => ({ status: "profileRequired" }));

    await user.type(screen.getByLabelText(/name/i), "Admin User");
    await user.type(screen.getByLabelText(/email address/i), "admin@example.test");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    expect(checkAccess).toHaveBeenCalledWith("Admin User", "admin@example.test");
    expect(sendOtp).toHaveBeenCalledWith("admin@example.test");

    await user.type(await screen.findByLabelText(/verification code/i), "123456");
    await user.click(screen.getByRole("button", { name: /verify/i }));

    expect(verifyOtp).toHaveBeenCalledWith("admin@example.test", "123456");
    expect(await screen.findByRole("heading", { name: /complete your profile/i })).toBeInTheDocument();
  });

  it("sends an active member to the trip calendar after OTP verification", async () => {
    const user = userEvent.setup();
    const { checkAccess, sendOtp, verifyOtp } = renderSignIn(async () => ({
      status: "active",
      role: "admin",
      displayName: "Admin",
    }));

    await user.type(screen.getByLabelText(/name/i), "Admin User");
    await user.type(screen.getByLabelText(/email address/i), "admin@example.test");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    expect(checkAccess).toHaveBeenCalledWith("Admin User", "admin@example.test");
    expect(sendOtp).toHaveBeenCalledWith("admin@example.test");

    await user.type(await screen.findByLabelText(/verification code/i), "654321");
    await user.click(screen.getByRole("button", { name: /verify/i }));

    expect(verifyOtp).toHaveBeenCalledWith("admin@example.test", "654321");
    expect(await screen.findByRole("heading", { name: /trip calendar/i })).toBeInTheDocument();
  });

  it("displays error when verifyOtp rejects", async () => {
    const user = userEvent.setup();
    const verifyOtp = vi.fn().mockRejectedValue(new Error("Invalid code"));
    renderSignIn(async () => ({ status: "active", role: "member", displayName: "Member" }), { verifyOtp });

    await user.type(screen.getByLabelText(/name/i), "Member User");
    await user.type(screen.getByLabelText(/email address/i), "member@example.test");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    await user.type(await screen.findByLabelText(/verification code/i), "000000");
    await user.click(screen.getByRole("button", { name: /verify/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/that code was not valid/i);
  });

  it("displays error when refresh fails after successful OTP verification", async () => {
    const user = userEvent.setup();
    renderSignIn(async () => {
      throw new Error("Failed to load membership");
    });

    await user.type(screen.getByLabelText(/name/i), "Member User");
    await user.type(screen.getByLabelText(/email address/i), "member@example.test");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    await user.type(await screen.findByLabelText(/verification code/i), "123456");
    await user.click(screen.getByRole("button", { name: /verify/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not check your club profile/i);
  });
});
