import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AdminTimeSlotManagerModal } from "./AdminTimeSlotManagerModal";
import type { TripTimeSlot, MasterResponsibility } from "./AdminTimeSlotManagerModal";

describe("AdminTimeSlotManagerModal", () => {
  const mockTripId = "11111111-1111-4111-8111-111111111111";

  const mockResponsibilities: MasterResponsibility[] = [
    {
      id: "resp-1",
      title: "Main Dish Cook",
      description: "Prepares main dinner course",
      category: "cooking",
      default_capacity: 2,
      workload_weight: 1.5,
      active: true,
    },
    {
      id: "resp-2",
      title: "Dishes & Kitchen Cleanup",
      description: "Cleans pots and pans",
      category: "cleanup",
      default_capacity: 2,
      workload_weight: 1.0,
      active: true,
    },
  ];

  const mockSlots: TripTimeSlot[] = [
    {
      id: "slot-1",
      trip_id: mockTripId,
      slot_date: "2026-10-16",
      time_block: "friday_dinner",
      slot_type: "meal",
      label: "Friday Dinner",
      is_custom: false,
      is_enabled: true,
      sort_order: 10,
      created_at: "2026-10-10T12:00:00Z",
      updated_at: "2026-10-10T12:00:00Z",
      duties: [
        {
          id: "duty-1",
          time_slot_id: "slot-1",
          master_responsibility_id: "resp-1",
          capacity: 2,
          workload_weight: 1.5,
          is_active: true,
          created_at: "2026-10-10T12:00:00Z",
          updated_at: "2026-10-10T12:00:00Z",
          responsibility: mockResponsibilities[0],
        },
      ],
    },
    {
      id: "slot-2",
      trip_id: mockTripId,
      slot_date: "2026-10-17",
      time_block: "saturday_morning",
      slot_type: "chore",
      label: "Saturday Campfire & Setup",
      is_custom: false,
      is_enabled: false,
      sort_order: 20,
      created_at: "2026-10-10T12:00:00Z",
      updated_at: "2026-10-10T12:00:00Z",
      duties: [],
    },
  ];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockApi: any;
  let onClose: () => void;

  beforeEach(() => {
    onClose = vi.fn();
    mockApi = vi.fn().mockImplementation((action: string) => {
      if (action === "get_trip_time_slots") {
        return Promise.resolve({ timeSlots: mockSlots, tripVersion: 7 });
      }
      if (action === "admin_list_master_responsibilities") {
        return Promise.resolve({ responsibilities: mockResponsibilities });
      }
      return Promise.resolve({});
    });
  });

  it("loads and displays time slots grouped by date with duties", async () => {
    render(
      <AdminTimeSlotManagerModal
        tripId={mockTripId}
        tripStartsOn="2026-10-16"
        tripEndsOn="2026-10-18"
        api={mockApi}
        onClose={onClose}
      />
    );

    expect(screen.getByText(/Loading time slots/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Friday Dinner")).toBeInTheDocument();
      expect(screen.getByText("Saturday Campfire & Setup")).toBeInTheDocument();
      expect(screen.getAllByText("Main Dish Cook").length).toBeGreaterThan(0);
      expect(screen.getByText("Disabled")).toBeInTheDocument();
    });
  });

  it("requires explicit responsibility choices for every actual date", async () => {
    mockApi.mockImplementation((action: string) => Promise.resolve(action === "get_trip_time_slots"
      ? { timeSlots: [], tripVersion: 7 }
      : action === "admin_list_master_responsibilities" ? { responsibilities: mockResponsibilities } : {}));
    render(<AdminTimeSlotManagerModal tripId={mockTripId} tripStartsOn="2026-10-19" tripEndsOn="2026-10-20" api={mockApi} onClose={onClose} />);
    const monday = await screen.findByRole("group", { name: /Monday.*2026-10-19/ });
    const tuesday = screen.getByRole("group", { name: /Tuesday.*2026-10-20/ });
    expect(screen.queryByRole("button", { name: /Generate Candidate Slots/ })).not.toBeInTheDocument();
    const { within } = await import("@testing-library/react");
    fireEvent.click(screen.getByRole("button", { name: "Save daily responsibilities" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/Choose at least one responsibility for every date/);
    fireEvent.click(within(monday).getByRole("checkbox", { name: /Main Dish Cook/ }));
    expect(within(monday).getByText(/Selected task weight: 1.5×.*Volunteer capacity: 3×/)).toBeInTheDocument();
    fireEvent.click(within(tuesday).getByRole("checkbox", { name: /Dishes & Kitchen Cleanup/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save daily responsibilities" }));
    await waitFor(() => expect(mockApi).toHaveBeenCalledWith("admin_save_daily_responsibilities", {
      tripId: mockTripId, expectedVersion: 7, confirmRemoval: false,
      days: [{ date: "2026-10-19", responsibilityIds: ["resp-1"] }, { date: "2026-10-20", responsibilityIds: ["resp-2"] }],
    }));
  });

  it("requires confirmation before removing a responsibility with volunteers", async () => {
    mockApi.mockImplementation((action: string) => Promise.resolve(action === "get_trip_time_slots"
      ? { timeSlots: mockSlots, tripVersion: 7, assignedDutyIds: ["duty-1"] }
      : action === "admin_list_master_responsibilities" ? { responsibilities: mockResponsibilities } : {}));
    render(<AdminTimeSlotManagerModal tripId={mockTripId} tripStartsOn="2026-10-16" tripEndsOn="2026-10-16" api={mockApi} onClose={onClose} />);
    const group = await screen.findByRole("group", { name: /Friday.*2026-10-16/ });
    const { within } = await import("@testing-library/react");
    fireEvent.click(within(group).getByRole("checkbox", { name: /Main Dish Cook/ }));
    fireEvent.click(within(group).getByRole("checkbox", { name: /Dishes & Kitchen Cleanup/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save daily responsibilities" }));
    expect(screen.getByRole("dialog", { name: "Confirm responsibility removal" })).toBeInTheDocument();
    expect(mockApi.mock.calls.filter((call: string[]) => call[0] === "admin_save_daily_responsibilities")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Confirm removal and save" }));
    await waitFor(() => expect(mockApi).toHaveBeenCalledWith("admin_save_daily_responsibilities", expect.objectContaining({ confirmRemoval: true })));
  });

  it("requires confirmation modal before disabling an enabled slot", async () => {
    render(
      <AdminTimeSlotManagerModal
        tripId={mockTripId}
        tripStartsOn="2026-10-16"
        tripEndsOn="2026-10-18"
        api={mockApi}
        onClose={onClose}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Friday Dinner")).toBeInTheDocument();
    });

    const disableBtn = screen.getByRole("button", { name: "Disable Slot" });
    fireEvent.click(disableBtn);

    // Modal prompt appears
    expect(screen.getByRole("dialog", { name: "Confirm Disable Slot" })).toBeInTheDocument();
    expect(screen.getByText(/Are you sure you want to disable/i)).toBeInTheDocument();

    const confirmBtn = screen.getByRole("button", { name: "Yes, Disable Slot" });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith("admin_configure_time_slot", {
        slotId: "slot-1",
        isEnabled: false,
      });
    });
  });

  it("enables a disabled slot directly without confirmation prompt", async () => {
    render(
      <AdminTimeSlotManagerModal
        tripId={mockTripId}
        tripStartsOn="2026-10-16"
        tripEndsOn="2026-10-18"
        api={mockApi}
        onClose={onClose}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Saturday Campfire & Setup")).toBeInTheDocument();
    });

    const enableBtn = screen.getByRole("button", { name: "Enable Slot" });
    fireEvent.click(enableBtn);

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith("admin_configure_time_slot", {
        slotId: "slot-2",
        isEnabled: true,
      });
    });
  });

  it("allows creating a custom time slot", async () => {
    render(
      <AdminTimeSlotManagerModal
        tripId={mockTripId}
        tripStartsOn="2026-10-16"
        tripEndsOn="2026-10-18"
        api={mockApi}
        onClose={onClose}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Friday Dinner")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Add Custom Slot/i }));

    fireEvent.change(screen.getByLabelText(/Label \*/i), {
      target: { value: "Saturday Afternoon Hike" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Create Slot" }));

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith("admin_create_custom_time_slot", {
        tripId: mockTripId,
        slotDate: "2026-10-16",
        timeBlock: "afternoon",
        slotType: "chore",
        label: "Saturday Afternoon Hike",
      });
    });
  });

  it("allows adding a duty to an active time slot", async () => {
    render(
      <AdminTimeSlotManagerModal
        tripId={mockTripId}
        tripStartsOn="2026-10-16"
        tripEndsOn="2026-10-18"
        api={mockApi}
        onClose={onClose}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Friday Dinner")).toBeInTheDocument();
    });

    const addDutyButtons = screen.getAllByRole("button", { name: "+ Add Duty" });
    fireEvent.click(addDutyButtons[0]);

    fireEvent.click(screen.getByRole("button", { name: "Save Duty" }));

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith("admin_add_slot_duty", {
        timeSlotId: "slot-1",
        masterResponsibilityId: "resp-1",
        capacity: 2,
        workloadWeight: 1.5,
      });
    });
  });

  it("allows adjusting capacity with stepper buttons", async () => {
    render(
      <AdminTimeSlotManagerModal
        tripId={mockTripId}
        tripStartsOn="2026-10-16"
        tripEndsOn="2026-10-18"
        api={mockApi}
        onClose={onClose}
      />
    );

    await waitFor(() => {
      expect(screen.getAllByText("Main Dish Cook").length).toBeGreaterThan(0);
    });

    const increaseBtn = screen.getByRole("button", { name: "Increase capacity" });
    fireEvent.click(increaseBtn);

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith("admin_update_slot_duty", {
        slotDutyId: "duty-1",
        capacity: 3,
      });
    });
  });
});
