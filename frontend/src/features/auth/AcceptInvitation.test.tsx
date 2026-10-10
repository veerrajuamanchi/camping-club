import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AcceptInvitation } from "./AcceptInvitation";
import * as supabaseLib from "../../lib/supabase";

vi.mock("../../lib/supabase", async () => {
  const actual = await vi.importActual<typeof supabaseLib>("../../lib/supabase");
  return {
    ...actual,
    invokeMemberApi: vi.fn(),
  };
});

describe("AcceptInvitation", () => {
  it("renders profile completion form and calls complete_profile on submit", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    const invokeMemberApiMock = vi.mocked(supabaseLib.invokeMemberApi).mockResolvedValue(undefined as never);

    render(<AcceptInvitation onComplete={onComplete} />);

    expect(screen.getAllByRole("heading", { name: /complete your profile/i })[0]).toBeInTheDocument();

    await user.type(screen.getByLabelText(/display name/i), "Test User");
    await user.type(screen.getByLabelText(/phone number/i), "+14155550123");
    await user.type(screen.getByLabelText(/payment handle or account email/i), "@testuser");
    await user.click(screen.getByRole("button", { name: /save profile/i }));

    expect(invokeMemberApiMock).toHaveBeenCalledWith("complete_profile", {
      displayName: "Test User",
      phoneE164: "+14155550123",
      paymentMethod: "venmo",
      paymentIdentifier: "@testuser",
    });
    expect(onComplete).toHaveBeenCalled();
  });
});
