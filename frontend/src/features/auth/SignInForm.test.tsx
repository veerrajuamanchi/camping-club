import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SignInForm } from "./SignInForm";

describe("SignInForm", () => {
  it("offers invitation-only sign in without a public registration path", () => {
    render(<SignInForm onSignIn={vi.fn()} />);

    expect(
      screen.getByRole("heading", { name: /member sign in/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/membership is by invitation only/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /sign up|create account/i }),
    ).not.toBeInTheDocument();
  });

  it("submits a trimmed email and password to the auth action", async () => {
    const user = userEvent.setup();
    const onSignIn = vi.fn().mockResolvedValue(undefined);
    render(<SignInForm onSignIn={onSignIn} />);

    await user.type(screen.getByLabelText(/email address/i), " member@example.test ");
    await user.type(screen.getByLabelText(/password/i), "test password");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(onSignIn).toHaveBeenCalledWith("member@example.test", "test password");
  });
});
