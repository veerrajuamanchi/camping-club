import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { MembershipState } from "./AccessBoundary";
import { SignInPage } from "./SignInPage";

function renderSignIn(refresh: () => Promise<MembershipState>) {
  const authenticate = vi.fn().mockResolvedValue(undefined);
  render(
    <MemoryRouter initialEntries={["/signin"]}>
      <Routes>
        <Route path="/signin" element={<SignInPage authenticate={authenticate} refresh={refresh} />} />
        <Route path="/accept-invitation" element={<h1>Complete your profile</h1>} />
        <Route path="/" element={<h1>Trip calendar</h1>} />
      </Routes>
    </MemoryRouter>,
  );
  return authenticate;
}

describe("SignInPage", () => {
  it("sends an invitee with no profile to profile completion after authentication", async () => {
    const user = userEvent.setup();
    const authenticate = renderSignIn(async () => ({ status: "profileRequired" }));

    await user.type(screen.getByLabelText(/email address/i), "admin@example.test");
    await user.type(screen.getByLabelText(/password/i), "test-password");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(authenticate).toHaveBeenCalledWith("admin@example.test", "test-password");
    expect(await screen.findByRole("heading", { name: /complete your profile/i })).toBeInTheDocument();
  });

  it("sends an active member to the trip calendar after authentication", async () => {
    const user = userEvent.setup();
    renderSignIn(async () => ({ status: "active", role: "admin", displayName: "Admin" }));

    await user.type(screen.getByLabelText(/email address/i), "admin@example.test");
    await user.type(screen.getByLabelText(/password/i), "test-password");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByRole("heading", { name: /trip calendar/i })).toBeInTheDocument();
  });
});
