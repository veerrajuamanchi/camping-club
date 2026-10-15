import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { MasterResponsibilitiesPage, type MasterResponsibility } from "./MasterResponsibilitiesPage";

const mockResponsibilities: MasterResponsibility[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Vegetable Prep",
    description: "Washing and chopping vegetables",
    category: "meal_prep",
    default_capacity: 2,
    workload_weight: 1.0,
    active: true,
    created_at: "2026-10-10T00:00:00Z",
    updated_at: "2026-10-10T00:00:00Z",
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    title: "Carpool Driver",
    description: "Driving attendees to campsite",
    category: "transport",
    default_capacity: 1,
    workload_weight: 2.0,
    active: true,
    created_at: "2026-10-10T00:00:00Z",
    updated_at: "2026-10-10T00:00:00Z",
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    title: "Old Game Host",
    description: "Retired host task",
    category: "activities",
    default_capacity: 1,
    workload_weight: 1.0,
    active: false,
    created_at: "2026-10-10T00:00:00Z",
    updated_at: "2026-10-10T00:00:00Z",
  },
];

describe("MasterResponsibilitiesPage", () => {
  it("totals every active template and its volunteer capacity while excluding retired templates", async () => {
    const api = vi.fn().mockResolvedValue({ responsibilities: mockResponsibilities });
    const user = userEvent.setup();
    render(<MemoryRouter><MasterResponsibilitiesPage api={api} /></MemoryRouter>);
    const summary = await screen.findByRole("region", { name: "Active workload summary" });
    expect(within(summary).getByLabelText("Total active template weight")).toHaveTextContent("3.0×");
    expect(within(summary).getByLabelText("Total active volunteer capacity weight")).toHaveTextContent("4.0×");
    await user.click(screen.getByRole("button", { name: /Transport & Driving/ }));
    await user.click(screen.getByLabelText("Show retired templates"));
    expect(within(summary).getByLabelText("Total active template weight")).toHaveTextContent("3.0×");
    expect(within(summary).getByLabelText("Total active volunteer capacity weight")).toHaveTextContent("4.0×");
  });

  it("renders list of master responsibilities with categories and weights", async () => {
    const api = vi.fn().mockImplementation((action: string) => {
      if (action === "admin_list_master_responsibilities") {
        return Promise.resolve({ responsibilities: mockResponsibilities });
      }
      return Promise.reject(new Error("unhandled"));
    });

    render(
      <MemoryRouter>
        <MasterResponsibilitiesPage api={api} />
      </MemoryRouter>
    );

    expect(screen.getByRole("status")).toHaveTextContent(/loading/i);

    await waitFor(() => {
      expect(screen.getByText("Vegetable Prep")).toBeInTheDocument();
      expect(screen.getByText("Carpool Driver")).toBeInTheDocument();
    });

    expect(screen.getByText(/2.0x weight/i)).toBeInTheDocument();
    expect(screen.getByText(/2 volunteers/i)).toBeInTheDocument();
  });

  it("allows opening modal and adding a new master responsibility", async () => {
    const user = userEvent.setup();
    const api = vi.fn().mockImplementation((action: string, input: unknown) => {
      if (action === "admin_list_master_responsibilities") {
        return Promise.resolve({ responsibilities: mockResponsibilities });
      }
      if (action === "admin_create_master_responsibility") {
        return Promise.resolve({
          responsibility: {
            id: "44444444-4444-4444-8444-444444444444",
            ...(input as Record<string, unknown>),
            active: true,
          },
        });
      }
      return Promise.reject(new Error("unhandled"));
    });

    render(
      <MemoryRouter>
        <MasterResponsibilitiesPage api={api} />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText("Vegetable Prep")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /\+ Add Responsibility/i }));
    expect(screen.getByRole("heading", { name: /Add Master Responsibility/i })).toBeInTheDocument();

    await user.type(screen.getByLabelText(/Title \*/i), "Campfire Setup");
    await user.selectOptions(screen.getByLabelText(/Category \*/i), "other");
    await user.clear(screen.getByLabelText(/Default Capacity \*/i));
    await user.type(screen.getByLabelText(/Default Capacity \*/i), "2");
    await user.type(screen.getByLabelText(/Description/i), "Build evening fire safely");

    await user.click(screen.getByRole("button", { name: /Save Responsibility/i }));

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith(
        "admin_create_master_responsibility",
        expect.objectContaining({
          title: "Campfire Setup",
          category: "other",
          defaultCapacity: 2,
        })
      );
    });
  });

  it("allows retiring and reactivating a responsibility", async () => {
    const user = userEvent.setup();
    const api = vi.fn().mockImplementation((action: string) => {
      if (action === "admin_list_master_responsibilities") {
        return Promise.resolve({ responsibilities: mockResponsibilities });
      }
      if (action === "admin_update_master_responsibility") {
        return Promise.resolve({ responsibility: { ...mockResponsibilities[0], active: false } });
      }
      return Promise.reject(new Error("unhandled"));
    });

    render(
      <MemoryRouter>
        <MasterResponsibilitiesPage api={api} />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText("Vegetable Prep")).toBeInTheDocument());

    const retireButtons = screen.getAllByRole("button", { name: /Retire/i });
    await user.click(retireButtons[0]);

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith(
        "admin_update_master_responsibility",
        expect.objectContaining({
          id: "11111111-1111-4111-8111-111111111111",
          active: false,
        })
      );
    });
  });
});
