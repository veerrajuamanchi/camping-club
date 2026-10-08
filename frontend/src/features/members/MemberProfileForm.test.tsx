import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MemberProfileForm } from "./MemberProfileForm";

describe("MemberProfileForm", () => {
  it("collects a member profile and one preferred external payment method", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<MemberProfileForm mode="complete" onSave={onSave} />);

    await user.type(screen.getByLabelText(/display name/i), "River Member");
    await user.type(screen.getByLabelText(/phone number/i), "+14155550123");
    await user.selectOptions(screen.getByLabelText(/preferred payment method/i), "venmo");
    await user.type(screen.getByLabelText(/payment handle or account email/i), "@river-member");
    await user.click(screen.getByRole("button", { name: /save profile/i }));

    expect(onSave).toHaveBeenCalledWith({
      displayName: "River Member",
      phoneE164: "+14155550123",
      paymentMethod: "venmo",
      paymentIdentifier: "@river-member",
    });
    await waitFor(() => {
      expect(
        screen.getByLabelText(/payment handle or account email/i),
      ).toHaveValue("");
    });
  });

  it("explains that the app records preferences but never moves money", () => {
    render(<MemberProfileForm mode="edit" onSave={vi.fn()} />);

    expect(
      screen.getByText(/the app never sends money/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/payment identifiers are encrypted/i),
    ).toBeInTheDocument();
  });
});
