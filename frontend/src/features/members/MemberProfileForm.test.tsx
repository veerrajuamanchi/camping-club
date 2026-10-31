import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MemberProfileForm, normalizePhoneE164 } from "./MemberProfileForm";

describe("normalizePhoneE164", () => {
  it("preserves valid E.164 phone numbers", () => {
    expect(normalizePhoneE164("+14155550123")).toEqual({ normalized: "+14155550123" });
    expect(normalizePhoneE164("+447911123456")).toEqual({ normalized: "+447911123456" });
    expect(normalizePhoneE164("+919876543210")).toEqual({ normalized: "+919876543210" });
  });

  it("strips formatting from valid international numbers", () => {
    expect(normalizePhoneE164("+1 (415) 555-0123")).toEqual({ normalized: "+14155550123" });
    expect(normalizePhoneE164("+1-415-555-0123")).toEqual({ normalized: "+14155550123" });
    expect(normalizePhoneE164("+44 7911 123456")).toEqual({ normalized: "+447911123456" });
  });

  it("normalizes standard 10-digit North American numbers by adding +1", () => {
    expect(normalizePhoneE164("4155550123")).toEqual({ normalized: "+14155550123" });
    expect(normalizePhoneE164("(415) 555-0123")).toEqual({ normalized: "+14155550123" });
    expect(normalizePhoneE164("415-555-0123")).toEqual({ normalized: "+14155550123" });
  });

  it("normalizes 11-digit North American numbers missing leading plus", () => {
    expect(normalizePhoneE164("14155550123")).toEqual({ normalized: "+14155550123" });
    expect(normalizePhoneE164("1-415-555-0123")).toEqual({ normalized: "+14155550123" });
  });

  it("flags invalid or incomplete phone numbers with helpful error", () => {
    const res1 = normalizePhoneE164("12345");
    expect(res1.error).toMatch(/international format/i);

    const res2 = normalizePhoneE164("abc");
    expect(res2.error).toMatch(/international format/i);

    const res3 = normalizePhoneE164("");
    expect(res3.error).toMatch(/required/i);
  });
});

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

  it("displays international format hint and placeholder", () => {
    render(<MemberProfileForm mode="complete" onSave={vi.fn()} />);

    const phoneInput = screen.getByLabelText(/phone number/i);
    expect(phoneInput).toHaveAttribute("placeholder", "+14155550123");
    expect(screen.getByText(/international format required/i)).toBeInTheDocument();
  });

  it("auto-normalizes phone numbers on submit when entered without country code", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<MemberProfileForm mode="complete" onSave={onSave} />);

    await user.type(screen.getByLabelText(/display name/i), "Sambath Tester");
    await user.type(screen.getByLabelText(/phone number/i), "(415) 555-0123");
    await user.type(screen.getByLabelText(/payment handle or account email/i), "sambath@zelle");
    await user.click(screen.getByRole("button", { name: /save profile/i }));

    expect(onSave).toHaveBeenCalledWith({
      displayName: "Sambath Tester",
      phoneE164: "+14155550123",
      paymentMethod: "venmo",
      paymentIdentifier: "sambath@zelle",
    });
  });

  it("displays explicit inline error and prevents submission when phone format is invalid", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<MemberProfileForm mode="complete" onSave={onSave} />);

    await user.type(screen.getByLabelText(/display name/i), "Sambath Tester");
    await user.type(screen.getByLabelText(/phone number/i), "12345");
    await user.type(screen.getByLabelText(/payment handle or account email/i), "sambath@zelle");
    await user.click(screen.getByRole("button", { name: /save profile/i }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/phone number must be in international format/i)).toBeInTheDocument();
  });

  it("displays existing payment handle in edit mode and preserves it on save", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <MemberProfileForm
        mode="edit"
        initialDisplayName="Alice Explorer"
        initialPhone="+14155550199"
        initialMethod="zelle"
        initialPaymentIdentifier="alice@example.com"
        onSave={onSave}
      />
    );

    const handleInput = screen.getByLabelText(/payment handle or account email/i);
    expect(handleInput).toHaveValue("alice@example.com");

    await user.click(screen.getByRole("button", { name: /save profile/i }));

    expect(onSave).toHaveBeenCalledWith({
      displayName: "Alice Explorer",
      phoneE164: "+14155550199",
      paymentMethod: "zelle",
      paymentIdentifier: "alice@example.com",
    });

    await waitFor(() => {
      expect(handleInput).toHaveValue("alice@example.com");
      expect(screen.getByText(/profile updated successfully/i)).toBeInTheDocument();
    });
  });
});
