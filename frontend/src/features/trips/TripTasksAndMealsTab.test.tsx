import { StrictMode } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TripTasksAndMealsTab } from "./TripTasksAndMealsTab";

const mockTaskMatrixData = {
  timeSlots: [
    {
      id: "slot-1",
      trip_id: "trip-1",
      slot_date: "2026-11-13",
      time_block: "friday_dinner",
      slot_type: "meal" as const,
      label: "Friday Dinner",
      is_custom: false,
      is_enabled: true,
      sort_order: 1,
      created_at: "2026-10-10T00:00:00Z",
      updated_at: "2026-10-10T00:00:00Z",
      duties: [
        {
          id: "duty-1",
          time_slot_id: "slot-1",
          master_responsibility_id: "resp-1",
          capacity: 2,
          workload_weight: 1.5,
          is_active: true,
          created_at: "2026-10-10T00:00:00Z",
          updated_at: "2026-10-10T00:00:00Z",
          responsibility: {
            id: "resp-1",
            title: "Main Dish Cook",
            description: "Cooks main dinner course",
            category: "cooking" as const,
            default_capacity: 2,
            workload_weight: 1.5,
            active: true,
          },
        },
        {
          id: "duty-2",
          time_slot_id: "slot-1",
          master_responsibility_id: "resp-2",
          capacity: 1,
          workload_weight: 1.0,
          is_active: true,
          created_at: "2026-10-10T00:00:00Z",
          updated_at: "2026-10-10T00:00:00Z",
          responsibility: {
            id: "resp-2",
            title: "Kitchen Cleanup",
            description: "Cleans dishes and kitchen area",
            category: "cleanup" as const,
            default_capacity: 2,
            workload_weight: 1.0,
            active: true,
          },
        },
      ],
    },
  ],
  activeAssignments: [
    {
      id: "assign-1",
      trip_id: "trip-1",
      slot_duty_id: "duty-2",
      member_id: "member-other",
      status: "claimed" as const,
      claimed_at: "2026-10-10T01:00:00Z",
      member: {
        member_id: "member-other",
        display_name: "Charlie Camper",
      },
    },
  ],
  driverCredits: [
    {
      id: "credit-1",
      trip_id: "trip-1",
      member_id: "member-1",
      workload_credit: 1.0,
      status: "approved" as const,
      notes: "Seattle carpool driver",
    },
  ],
  myQuotaProgress: {
    claimed_count: 1,
    claimed_weight: 1.5,
    driver_credit: 1.0,
    total_score: 2.5,
    quota_target: 2,
    target_reached: true,
  },
  confirmedAttendees: [
    { memberId: "member-1", displayName: "Alice (You)" },
    { memberId: "member-other", displayName: "Charlie Camper" },
  ],
};

describe("TripTasksAndMealsTab", () => {
  it("shows newly planned duties when the event version changes", async () => {
    let matrix = { ...mockTaskMatrixData, timeSlots: [] as typeof mockTaskMatrixData.timeSlots };
    const api = vi.fn().mockImplementation(async () => matrix);
    const props = { tripId: "trip-1", isConfirmedAttendee: false, isAdmin: true, currentMemberId: "member-1", api };
    const { rerender } = render(<TripTasksAndMealsTab {...props} refreshVersion={1} />);
    expect(await screen.findByText("No meal or chore slots scheduled yet.")).toBeInTheDocument();
    matrix = mockTaskMatrixData;
    rerender(<TripTasksAndMealsTab {...props} refreshVersion={2} />);
    expect((await screen.findAllByText("Friday Dinner"))[0]).toBeInTheDocument();
  });

  it("ignores an older matrix response after the admin starts editing", async () => {
    let resolveOld!: (value: unknown) => void;
    const snapshot = { ...mockTaskMatrixData, myDailyWorkload: { target: null, tripVersion: 1, satisfied: true, days: [] } };
    const api = vi.fn().mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; })).mockResolvedValue(snapshot);
    render(<StrictMode><TripTasksAndMealsTab tripId="trip-1" isConfirmedAttendee={false} isAdmin={true} currentMemberId="member-1" api={api} /></StrictMode>);
    const toggle = await screen.findByLabelText("Use a daily workload target for this trip");
    await userEvent.click(toggle);
    await userEvent.clear(screen.getByLabelText("Daily workload target (×)"));
    await userEvent.type(screen.getByLabelText("Daily workload target (×)"), "6");
    await act(async () => resolveOld(snapshot));
    expect(toggle).toBeChecked();
    expect(screen.getByLabelText("Daily workload target (×)")).toHaveValue(6);
  });

  it("shows daily weighted progress and excuses days with no eligible slots", async () => {
    const api = vi.fn().mockResolvedValue({ ...mockTaskMatrixData, myDailyWorkload: {
      target: 4, tripVersion: 1, satisfied: false, days: [
        { date: "2026-11-13", selectedWeight: 2.5, totalWeight: 8, remainingWeight: 2, eligibleSlots: 1, status: "needs_selection" },
        { date: "2026-11-14", selectedWeight: 1, totalWeight: 8, remainingWeight: 0, eligibleSlots: 0, status: "no_tasks_available" },
      ],
    } });
    render(<TripTasksAndMealsTab tripId="trip-1" isConfirmedAttendee={true} isAdmin={false} currentMemberId="member-1" api={api} />);
    expect(await screen.findByText("2.5× / 4×")).toBeInTheDocument();
    expect(screen.getByText(/Select at least 1.5× more/)).toBeInTheDocument();
    expect(screen.getByText(/No tasks available.*No additional selection required/)).toBeInTheDocument();
    expect(screen.queryByText(/1 of 2 responsibilities selected/)).not.toBeInTheDocument();
  });

  it("renders chronological time slots, duties, capacity, and quota progress", async () => {
    const api = vi.fn().mockImplementation(async (action: string) => {
      if (action === "get_trip_task_matrix") return mockTaskMatrixData;
      return {};
    });

    render(
      <TripTasksAndMealsTab
        tripId="trip-1"
        isConfirmedAttendee={true}
        isAdmin={false}
        currentMemberId="member-1"
        api={api}
      />
    );

    expect(screen.getByText(/Loading meal & chore tasks/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Your Trip Responsibility Progress")).toBeInTheDocument();
    });

    expect(screen.getByText(/1 of 2 responsibilities selected \(Target reached\)/i)).toBeInTheDocument();
    expect(screen.getByText("+1x Credit")).toBeInTheDocument();
    expect(screen.getAllByText("Friday Dinner").length).toBeGreaterThan(0);
    expect(screen.getByText("Main Dish Cook")).toBeInTheDocument();
    expect(screen.getByText("Kitchen Cleanup")).toBeInTheDocument();
    // Kitchen cleanup is full (capacity 1, 1 assigned)
    expect(screen.getByText("1 / 1 filled")).toBeInTheDocument();
    expect(screen.getByText("Charlie Camper")).toBeInTheDocument();
  });

  it("allows confirmed member to volunteer for an open duty", async () => {
    const user = userEvent.setup();
    const api = vi.fn().mockImplementation(async (action: string) => {
      if (action === "get_trip_task_matrix") return mockTaskMatrixData;
      if (action === "claim_duty") return { success: true };
      return {};
    });

    render(
      <TripTasksAndMealsTab
        tripId="trip-1"
        isConfirmedAttendee={true}
        isAdmin={false}
        currentMemberId="member-1"
        api={api}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Main Dish Cook")).toBeInTheDocument();
    });

    const volunteerBtn = screen.getByRole("button", { name: /^Volunteer$/i });
    expect(volunteerBtn).toBeEnabled();

    await user.click(volunteerBtn);

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith("claim_duty", {
        slotDutyId: "duty-1",
        acknowledgeOverlap: false,
      });
    });
  });

  it("handles schedule overlap detection and prompts for acknowledgment", async () => {
    const user = userEvent.setup();
    const api = vi.fn().mockImplementation(async (action: string) => {
      if (action === "get_trip_task_matrix") return mockTaskMatrixData;
      if (action === "claim_duty") {
        return {
          overlap_detected: true,
          message: "You already have Kitchen Cleanup scheduled for this time block.",
        };
      }
      return {};
    });

    render(
      <TripTasksAndMealsTab
        tripId="trip-1"
        isConfirmedAttendee={true}
        isAdmin={false}
        currentMemberId="member-1"
        api={api}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Main Dish Cook")).toBeInTheDocument();
    });

    const volunteerBtn = screen.getByRole("button", { name: /^Volunteer$/i });
    await user.click(volunteerBtn);

    await waitFor(() => {
      expect(screen.getByText(/Schedule Overlap Warning/i)).toBeInTheDocument();
    });

    const proceedBtn = screen.getByRole("button", { name: /Proceed & Volunteer/i });
    await user.click(proceedBtn);

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith("claim_duty", {
        slotDutyId: "duty-1",
        acknowledgeOverlap: true,
      });
    });
  });

  it("allows a member to drop their claimed duty", async () => {
    const user = userEvent.setup();
    window.confirm = vi.fn().mockReturnValue(true);

    const dataWithMyClaim = {
      ...mockTaskMatrixData,
      activeAssignments: [
        {
          id: "assign-my-claim",
          trip_id: "trip-1",
          slot_duty_id: "duty-1",
          member_id: "member-1",
          status: "claimed" as const,
          claimed_at: "2026-10-10T01:00:00Z",
          member: {
            member_id: "member-1",
            display_name: "Alice (You)",
          },
        },
      ],
    };

    const api = vi.fn().mockImplementation(async (action: string) => {
      if (action === "get_trip_task_matrix") return dataWithMyClaim;
      if (action === "drop_duty") return { dropped: true };
      return {};
    });

    render(
      <TripTasksAndMealsTab
        tripId="trip-1"
        isConfirmedAttendee={true}
        isAdmin={false}
        currentMemberId="member-1"
        api={api}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Drop Task")).toBeInTheDocument();
    });

    const dropBtn = screen.getByRole("button", { name: /Drop Task/i });
    await user.click(dropBtn);

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith("drop_duty", {
        assignmentId: "assign-my-claim",
        reason: "Member dropped from UI",
      });
    });
  });

  it("allows administrators to grant driver workload credits", async () => {
    const user = userEvent.setup();
    const api = vi.fn().mockImplementation(async (action: string) => {
      if (action === "get_trip_task_matrix") return mockTaskMatrixData;
      if (action === "admin_set_driver_credit") return { id: "credit-2" };
      return {};
    });

    render(
      <TripTasksAndMealsTab
        tripId="trip-1"
        isConfirmedAttendee={true}
        isAdmin={true}
        currentMemberId="member-1"
        api={api}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /\+ Grant Driver Credit/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /\+ Grant Driver Credit/i }));

    expect(screen.getByText("Grant Driver Workload Credit")).toBeInTheDocument();

    const driverSelect = screen.getByRole("combobox", { name: /Driver \(Attendee\):/i });
    await user.selectOptions(driverSelect, "member-1");

    const grantBtn = screen.getByRole("button", { name: /^Grant Credit$/i });
    await user.click(grantBtn);

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith("admin_set_driver_credit", {
        tripId: "trip-1",
        memberId: "member-1",
        workloadCredit: 1.0,
        status: "approved",
        notes: undefined,
      });
    });
  });

  it("allows administrators to assign a camper to a duty", async () => {
    const user = userEvent.setup();
    const api = vi.fn().mockImplementation(async (action: string) => {
      if (action === "get_trip_task_matrix") return mockTaskMatrixData;
      if (action === "admin_assign_duty") return { assigned: true };
      return {};
    });

    render(
      <TripTasksAndMealsTab
        tripId="trip-1"
        isConfirmedAttendee={true}
        isAdmin={true}
        currentMemberId="member-1"
        api={api}
      />
    );

    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /Assign…/i })[0]).toBeInTheDocument();
    });

    await user.click(screen.getAllByRole("button", { name: /Assign…/i })[0]);

    expect(screen.getByText(/Assign Volunteer: Main Dish Cook/i)).toBeInTheDocument();

    const memberSelect = screen.getByRole("combobox", { name: /Camper:/i });
    await user.selectOptions(memberSelect, "member-other");

    const assignCamperBtn = screen.getByRole("button", { name: /^Assign Camper$/i });
    await user.click(assignCamperBtn);

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith("admin_assign_duty", {
        slotDutyId: "duty-1",
        memberId: "member-other",
      });
    });
  });

  it("disables volunteering for non-confirmed attendees", async () => {
    const api = vi.fn().mockImplementation(async (action: string) => {
      if (action === "get_trip_task_matrix") return mockTaskMatrixData;
      return {};
    });

    render(
      <TripTasksAndMealsTab
        tripId="trip-1"
        isConfirmedAttendee={false}
        isAdmin={false}
        currentMemberId="member-not-going"
        api={api}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/You are not currently a confirmed attendee/i)).toBeInTheDocument();
    });

    const volunteerBtn = screen.getByRole("button", { name: /^Volunteer$/i });
    expect(volunteerBtn).toBeDisabled();
  });

  it("greys out remaining open duties for the day once the member selects a chore for that day", async () => {
    const dataWithMyClaimOnDate = {
      ...mockTaskMatrixData,
      activeAssignments: [
        {
          id: "assign-my-claim",
          trip_id: "trip-1",
          slot_duty_id: "duty-1",
          member_id: "member-1",
          status: "claimed" as const,
          claimed_at: "2026-10-10T01:00:00Z",
          member: {
            member_id: "member-1",
            display_name: "Alice (You)",
          },
        },
      ],
    };

    const api = vi.fn().mockResolvedValue(dataWithMyClaimOnDate);

    render(
      <TripTasksAndMealsTab
        tripId="trip-1"
        isConfirmedAttendee={true}
        isAdmin={false}
        currentMemberId="member-1"
        api={api}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Main Dish Cook")).toBeInTheDocument();
    });

    // The claimed duty has Drop Task
    expect(screen.getByRole("button", { name: /Drop Task/i })).toBeInTheDocument();

    // The other duty on that day has "Done for Day" disabled button
    expect(screen.getByRole("button", { name: /Done for Day/i })).toBeDisabled();

    // Daily chores selected badge is displayed
    expect(screen.getByText("✓ Daily chores selected")).toBeInTheDocument();
  });
});
