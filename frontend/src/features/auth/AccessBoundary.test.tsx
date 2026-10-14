import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AccessBoundary, type MembershipState } from "./AccessBoundary";

const privateContent = <p>Confidential member area</p>;

describe("AccessBoundary", () => {
  it("keeps private content hidden while signed out", () => {
    const state: MembershipState = { status: "signedOut" };
    render(
      <AccessBoundary state={state} requiredRole="member">
        {privateContent}
      </AccessBoundary>,
    );

    expect(screen.queryByText("Confidential member area")).not.toBeInTheDocument();
    expect(screen.getByText(/sign in to continue/i)).toBeInTheDocument();
  });

  it("denies member access to administrator routes", () => {
    const state: MembershipState = {
      status: "active",
      role: "member",
      displayName: "River Member",
    };
    render(
      <AccessBoundary state={state} requiredRole="admin">
        {privateContent}
      </AccessBoundary>,
    );

    expect(screen.queryByText("Confidential member area")).not.toBeInTheDocument();
    expect(screen.getByText(/administrator access is required/i)).toBeInTheDocument();
  });

  it("shows protected content to an active administrator", () => {
    const state: MembershipState = {
      status: "active",
      role: "admin",
      displayName: "Club Admin",
    };
    render(
      <AccessBoundary state={state} requiredRole="admin">
        {privateContent}
      </AccessBoundary>,
    );

    expect(screen.getByText("Confidential member area")).toBeInTheDocument();
  });

  it("denies private content for an inactive account", () => {
    const state: MembershipState = { status: "inactive" };
    render(
      <AccessBoundary state={state} requiredRole="member">
        {privateContent}
      </AccessBoundary>,
    );

    expect(screen.queryByText("Confidential member area")).not.toBeInTheDocument();
    expect(screen.getByText(/club access is inactive/i)).toBeInTheDocument();
  });

  it("renders sign out button for inactive account and triggers callback", () => {
    const state: MembershipState = { status: "inactive" };
    const onSignOut = vi.fn();
    render(
      <AccessBoundary state={state} requiredRole="member" onSignOut={onSignOut}>
        {privateContent}
      </AccessBoundary>,
    );

    const signOutBtn = screen.getByRole("button", { name: /sign out & return to sign in/i });
    expect(signOutBtn).toBeInTheDocument();
    signOutBtn.click();
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });
});
