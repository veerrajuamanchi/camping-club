import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AdminMembersPage } from "./AdminMembersPage";

const mockInvokeMemberApi = vi.fn();

vi.mock("../../lib/supabase", () => ({
  invokeMemberApi: (...args: unknown[]) => mockInvokeMemberApi(...args),
}));

describe("AdminMembersPage - Access Requests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvokeMemberApi.mockImplementation((action: string) => {
      if (action === "list_members") {
        return Promise.resolve({ members: [] });
      }
      if (action === "list_access_requests") {
        return Promise.resolve({ requests: [] });
      }
      return Promise.resolve({});
    });
  });

  it("shows pending access requests", async () => {
    mockInvokeMemberApi.mockImplementation((action: string) => {
      if (action === "list_access_requests") {
        return Promise.resolve({
          requests: [
            { id: "req-1", display_name: "New User", created_at: "2026-10-01T00:00:00Z" },
            { id: "req-2", display_name: "Another Applicant", created_at: "2026-10-02T00:00:00Z" },
          ],
        });
      }
      if (action === "list_members") {
        return Promise.resolve({ members: [] });
      }
      return Promise.resolve({});
    });

    render(<AdminMembersPage />);

    expect(await screen.findByRole("heading", { name: "Access requests" })).toBeInTheDocument();
    expect(screen.getByText("New User")).toBeInTheDocument();
    expect(screen.getByText("Another Applicant")).toBeInTheDocument();
  });

  it("approves an access request and updates the list", async () => {
    const user = userEvent.setup();
    mockInvokeMemberApi.mockImplementation((action: string) => {
      if (action === "list_access_requests") {
        return Promise.resolve({
          requests: [{ id: "req-1", display_name: "New User", created_at: "2026-10-01T00:00:00Z" }],
        });
      }
      if (action === "list_members") {
        return Promise.resolve({ members: [] });
      }
      if (action === "approve_access_request") {
        return Promise.resolve({ resolved: true });
      }
      return Promise.resolve({});
    });

    render(<AdminMembersPage />);

    expect(await screen.findByText("New User")).toBeInTheDocument();
    const approveBtn = screen.getByRole("button", { name: "Approve" });
    await user.click(approveBtn);

    await waitFor(() => {
      expect(mockInvokeMemberApi).toHaveBeenCalledWith("approve_access_request", { requestId: "req-1" });
    });

    expect(await screen.findByText("Request approved and invitation email sent.")).toBeInTheDocument();
    expect(screen.queryByText("New User")).not.toBeInTheDocument();
    expect(screen.getByText("No pending requests.")).toBeInTheDocument();
  });

  it("rejects an access request and updates the list", async () => {
    const user = userEvent.setup();
    mockInvokeMemberApi.mockImplementation((action: string) => {
      if (action === "list_access_requests") {
        return Promise.resolve({
          requests: [{ id: "req-1", display_name: "New User", created_at: "2026-10-01T00:00:00Z" }],
        });
      }
      if (action === "list_members") {
        return Promise.resolve({ members: [] });
      }
      if (action === "reject_access_request") {
        return Promise.resolve({ resolved: true });
      }
      return Promise.resolve({});
    });

    render(<AdminMembersPage />);

    expect(await screen.findByText("New User")).toBeInTheDocument();
    const rejectBtn = screen.getByRole("button", { name: "Reject" });
    await user.click(rejectBtn);

    await waitFor(() => {
      expect(mockInvokeMemberApi).toHaveBeenCalledWith("reject_access_request", { requestId: "req-1" });
    });

    expect(await screen.findByText("Request rejected.")).toBeInTheDocument();
    expect(screen.queryByText("New User")).not.toBeInTheDocument();
    expect(screen.getByText("No pending requests.")).toBeInTheDocument();
  });

  it("displays error state when loading access requests fails", async () => {
    mockInvokeMemberApi.mockImplementation((action: string) => {
      if (action === "list_access_requests") {
        return Promise.reject(new Error("Network failure"));
      }
      if (action === "list_members") {
        return Promise.resolve({ members: [] });
      }
      return Promise.resolve({});
    });

    render(<AdminMembersPage />);

    expect(await screen.findByText("Could not load access requests.")).toBeInTheDocument();
  });

  it("displays error state when resolving an access request fails and keeps item in list", async () => {
    const user = userEvent.setup();
    mockInvokeMemberApi.mockImplementation((action: string) => {
      if (action === "list_access_requests") {
        return Promise.resolve({
          requests: [{ id: "req-1", display_name: "New User", created_at: "2026-10-01T00:00:00Z" }],
        });
      }
      if (action === "list_members") {
        return Promise.resolve({ members: [] });
      }
      if (action === "approve_access_request") {
        return Promise.reject(new Error("Internal Server Error"));
      }
      return Promise.resolve({});
    });

    render(<AdminMembersPage />);

    expect(await screen.findByText("New User")).toBeInTheDocument();
    const approveBtn = screen.getByRole("button", { name: "Approve" });
    await user.click(approveBtn);

    expect(await screen.findByText("Could not process request. Try again.")).toBeInTheDocument();
    expect(screen.getByText("New User")).toBeInTheDocument();
  });

  it("does not render the access requests section when there are no pending requests", async () => {
    mockInvokeMemberApi.mockImplementation((action: string) => {
      if (action === "list_access_requests") {
        return Promise.resolve({ requests: [] });
      }
      if (action === "list_members") {
        return Promise.resolve({ members: [] });
      }
      return Promise.resolve({});
    });

    render(<AdminMembersPage />);

    // Wait for members section to load
    expect(await screen.findByRole("heading", { name: /administrator · members/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Access requests" })).not.toBeInTheDocument();
  });

  it("preserves member invite functionality", async () => {
    const user = userEvent.setup();
    mockInvokeMemberApi.mockImplementation((action: string) => {
      if (action === "list_access_requests") {
        return Promise.resolve({ requests: [] });
      }
      if (action === "list_members") {
        return Promise.resolve({
          members: [
            {
              member_id: "m-1",
              display_name: "Existing Member",
              member_role: "member",
              account_status: "active",
              created_at: "2026-09-01T00:00:00Z",
            },
          ],
        });
      }
      if (action === "invite_member") {
        return Promise.resolve({ invitationId: "inv-1" });
      }
      return Promise.resolve({});
    });

    render(<AdminMembersPage />);

    expect(await screen.findByText("Existing Member")).toBeInTheDocument();

    const emailInput = screen.getByLabelText(/invite by email/i);
    await user.type(emailInput, "newmember@example.com");
    await user.click(screen.getByRole("button", { name: /send invitation/i }));

    await waitFor(() => {
      expect(mockInvokeMemberApi).toHaveBeenCalledWith("invite_member", { email: "newmember@example.com" });
    });
    expect(await screen.findByText("Invitation sent.")).toBeInTheDocument();
  });
});
