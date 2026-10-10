import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SignInForm } from "./SignInForm";

describe("SignInForm", () => {
  it("renders name and email inputs with continue button", () => {
    render(<SignInForm checkAccess={vi.fn()} sendOtp={vi.fn()} verifyOtp={vi.fn()} />);

    expect(screen.getByRole("heading", { name: /sign in to the camping club/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue/i })).toBeInTheDocument();
  });

  it("shows OTP entry after email submitted for approved member", async () => {
    const user = userEvent.setup();
    const checkAccess = vi.fn().mockResolvedValue({ status: "approved_member" });
    const sendOtp = vi.fn().mockResolvedValue(undefined);
    const verifyOtp = vi.fn();
    render(<SignInForm checkAccess={checkAccess} sendOtp={sendOtp} verifyOtp={verifyOtp} />);

    await user.type(screen.getByLabelText(/name/i), "Alice");
    await user.type(screen.getByLabelText(/email/i), "alice@example.com");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    expect(checkAccess).toHaveBeenCalledWith("Alice", "alice@example.com");
    expect(sendOtp).toHaveBeenCalledWith("alice@example.com");
    expect(await screen.findByLabelText(/verification code/i)).toBeInTheDocument();
  });

  it("shows pending notice for duplicate access request", async () => {
    const user = userEvent.setup();
    const checkAccess = vi.fn().mockResolvedValue({ status: "duplicate_request" });
    const sendOtp = vi.fn();
    render(<SignInForm checkAccess={checkAccess} sendOtp={sendOtp} verifyOtp={vi.fn()} />);

    await user.type(screen.getByLabelText(/name/i), "Bob");
    await user.type(screen.getByLabelText(/email/i), "bob@example.com");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    expect(sendOtp).not.toHaveBeenCalled();
    expect(await screen.findByText(/request.*pending/i)).toBeInTheDocument();
  });

  it("shows success notice for new access request", async () => {
    const user = userEvent.setup();
    const checkAccess = vi.fn().mockResolvedValue({ status: "new_request_created" });
    const sendOtp = vi.fn();
    render(<SignInForm checkAccess={checkAccess} sendOtp={sendOtp} verifyOtp={vi.fn()} />);

    await user.type(screen.getByLabelText(/name/i), "Carol");
    await user.type(screen.getByLabelText(/email/i), "carol@example.com");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    expect(sendOtp).not.toHaveBeenCalled();
    expect(await screen.findByText(/request.*submitted/i)).toBeInTheDocument();
  });

  it("submits verification code when verifying OTP", async () => {
    const user = userEvent.setup();
    const checkAccess = vi.fn().mockResolvedValue({ status: "approved_member" });
    const sendOtp = vi.fn().mockResolvedValue(undefined);
    const verifyOtp = vi.fn().mockResolvedValue(undefined);
    render(<SignInForm checkAccess={checkAccess} sendOtp={sendOtp} verifyOtp={verifyOtp} />);

    await user.type(screen.getByLabelText(/name/i), "Alice");
    await user.type(screen.getByLabelText(/email/i), "alice@example.com");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    await user.type(await screen.findByLabelText(/verification code/i), "123456");
    await user.click(screen.getByRole("button", { name: /verify/i }));

    expect(verifyOtp).toHaveBeenCalledWith("alice@example.com", "123456");
  });

  it("allows switching back to identify step with 'Use a different email'", async () => {
    const user = userEvent.setup();
    const checkAccess = vi.fn().mockResolvedValue({ status: "approved_member" });
    const sendOtp = vi.fn().mockResolvedValue(undefined);
    render(<SignInForm checkAccess={checkAccess} sendOtp={sendOtp} verifyOtp={vi.fn()} />);

    await user.type(screen.getByLabelText(/name/i), "Alice");
    await user.type(screen.getByLabelText(/email/i), "alice@example.com");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    expect(await screen.findByLabelText(/verification code/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /use a different email/i }));

    expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
  });

  it("shows pending notice for pending_request status", async () => {
    const user = userEvent.setup();
    const checkAccess = vi.fn().mockResolvedValue({ status: "pending_request" });
    const sendOtp = vi.fn();
    render(<SignInForm checkAccess={checkAccess} sendOtp={sendOtp} verifyOtp={vi.fn()} />);

    await user.type(screen.getByLabelText(/name/i), "Dave");
    await user.type(screen.getByLabelText(/email/i), "dave@example.com");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    expect(sendOtp).not.toHaveBeenCalled();
    expect(await screen.findByText(/request.*pending/i)).toBeInTheDocument();
  });

  it("displays an error message when checkAccess throws", async () => {
    const user = userEvent.setup();
    const checkAccess = vi.fn().mockRejectedValue(new Error("Network error"));
    render(<SignInForm checkAccess={checkAccess} sendOtp={vi.fn()} verifyOtp={vi.fn()} />);

    await user.type(screen.getByLabelText(/name/i), "Eve");
    await user.type(screen.getByLabelText(/email/i), "eve@example.com");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/something went wrong/i);
  });

  it("displays an error message when verifyOtp throws", async () => {
    const user = userEvent.setup();
    const checkAccess = vi.fn().mockResolvedValue({ status: "approved_member" });
    const sendOtp = vi.fn().mockResolvedValue(undefined);
    const verifyOtp = vi.fn().mockRejectedValue(new Error("Invalid code"));
    render(<SignInForm checkAccess={checkAccess} sendOtp={sendOtp} verifyOtp={verifyOtp} />);

    await user.type(screen.getByLabelText(/name/i), "Alice");
    await user.type(screen.getByLabelText(/email/i), "alice@example.com");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    await user.type(await screen.findByLabelText(/verification code/i), "000000");
    await user.click(screen.getByRole("button", { name: /verify/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/that code was not valid/i);
  });
});
