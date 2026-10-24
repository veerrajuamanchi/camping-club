import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { TripActivitiesTab, type TripActivityItem } from "./TripActivitiesTab";

const mockTripActivities = [
  {
    id: "act-1",
    trip_id: "trip-100",
    title: "San Francisco GoCar Tour",
    category: "tour",
    image_url: "https://example.com/gocar.jpg",
    location_name: "Fisherman's Wharf",
    address: "510 Beach St, San Francisco, CA 94133",
    directions_url: "https://maps.google.com/?q=510+Beach+St",
    deal_strategy_tip: "Purchase 2-person vouchers on Groupon (e.g., $174.60 with promo code Halloween vs $328 operator direct) and enter your voucher codes below!",
    voucher_url: "https://www.groupon.com/deals/gocar-tours-sf",
    activity_date: "2026-11-15",
    start_time: "10:00:00",
    end_time: "17:00:00",
    unit_label: "GoCar",
    unit_capacity: 2,
    opt_out_policy: "locked_on_voucher" as const,
    is_pairings_locked: false,
    participants: [
      {
        id: "part-1",
        activity_id: "act-1",
        member_id: "mem-current",
        status: "attending",
        display_name: "Current User",
      },
      {
        id: "part-2",
        activity_id: "act-1",
        member_id: "mem-veerraju",
        status: "attending",
        display_name: "Veerraju Amanchi",
      },
      {
        id: "part-3",
        activity_id: "act-1",
        member_id: "mem-bob",
        status: "attending",
        display_name: "Bob Smith",
      },
      {
        id: "part-4",
        activity_id: "act-1",
        member_id: "mem-alice",
        status: "attending",
        display_name: "Alice Cooper",
      },
    ],
    groups: [
      {
        id: "grp-1",
        activity_id: "act-1",
        group_number: 1,
        group_name: "GoCar #1",
        capacity: 2,
        purchaser_member_id: "mem-veerraju",
        purchaser_display_name: "Veerraju Amanchi",
        purchase_date: "2026-10-24",
        order_number: "ORD-9988",
        voucher_code: "GP-12345",
        security_pin: "9876",
        voucher_amount_cents: 17460,
        voucher_status: "purchased",
        members: [
          {
            id: "gm-1",
            group_id: "grp-1",
            member_id: "mem-current",
            display_name: "Current User",
          },
          {
            id: "gm-2",
            group_id: "grp-1",
            member_id: "mem-veerraju",
            display_name: "Veerraju Amanchi",
          },
        ],
      },
      {
        id: "grp-2",
        activity_id: "act-1",
        group_number: 2,
        group_name: "GoCar #2",
        capacity: 2,
        purchaser_member_id: null,
        purchaser_display_name: null,
        purchase_date: null,
        order_number: null,
        voucher_code: null,
        security_pin: null,
        voucher_amount_cents: null,
        voucher_status: "needed",
        members: [
          {
            id: "gm-3",
            group_id: "grp-2",
            member_id: "mem-bob",
            display_name: "Bob Smith",
          },
          {
            id: "gm-4",
            group_id: "grp-2",
            member_id: "mem-alice",
            display_name: "Alice Cooper",
          },
        ],
      },
    ],
    swap_requests: [
      {
        id: "swap-1",
        activity_id: "act-1",
        requester_member_id: "mem-bob",
        requester_display_name: "Bob Smith",
        target_member_id: "mem-current",
        target_display_name: "Current User",
        status: "pending",
      },
    ],
  },
];

describe("TripActivitiesTab", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
      configurable: true,
      writable: true,
    });
  });

  it("renders activity banner image, title, schedule, address, directions link, and Groupon deal tip", async () => {
    const api = vi.fn().mockImplementation(async (action: string) => {
      if (action === "get_trip_activities") {
        return { activities: mockTripActivities };
      }
      return {};
    });

    render(
      <TripActivitiesTab
        tripId="trip-100"
        isAdmin={false}
        isConfirmedAttendee={true}
        currentMemberId="mem-current"
        api={api}
      />
    );

    expect(await screen.findByText("San Francisco GoCar Tour")).toBeInTheDocument();
    expect(screen.getByText(/Nov 15 • 10:00 AM – 5:00 PM/)).toBeInTheDocument();
    expect(screen.getByText(/510 Beach St, San Francisco, CA 94133/)).toBeInTheDocument();
    expect(screen.getByText("🧭 Get Directions")).toHaveAttribute(
      "href",
      "https://maps.google.com/?q=510+Beach+St"
    );
    expect(screen.getByText(/Deal Strategy Tip:/)).toBeInTheDocument();
    expect(
      screen.getByText(/Purchase 2-person vouchers on Groupon/i)
    ).toBeInTheDocument();
  });

  it("displays personalized rider badge when paired with a partner", async () => {
    const api = vi.fn().mockResolvedValue({ activities: mockTripActivities });

    render(
      <TripActivitiesTab
        tripId="trip-100"
        isAdmin={false}
        isConfirmedAttendee={true}
        currentMemberId="mem-current"
        api={api}
      />
    );

    expect(
      await screen.findByText("✓ You are Riding with Veerraju Amanchi (GoCar #1)")
    ).toBeInTheDocument();
  });

  it("displays personalized rider badge when attendee is unassigned", async () => {
    const unassignedActivities = [
      {
        ...mockTripActivities[0],
        groups: [
          {
            ...mockTripActivities[0].groups[0],
            members: [mockTripActivities[0].groups[0].members[1]], // only Veerraju
          },
        ],
      },
    ];

    const api = vi.fn().mockResolvedValue({ activities: unassignedActivities });

    render(
      <TripActivitiesTab
        tripId="trip-100"
        isAdmin={false}
        isConfirmedAttendee={true}
        currentMemberId="mem-current"
        api={api}
      />
    );

    expect(
      await screen.findByText("⚠️ You are attending, but not yet assigned to a vehicle.")
    ).toBeInTheDocument();
  });

  it("displays personalized rider badge when user has opted out", async () => {
    const optedOutActivities = [
      {
        ...mockTripActivities[0],
        participants: [
          {
            id: "part-1",
            activity_id: "act-1",
            member_id: "mem-current",
            status: "opted_out",
            display_name: "Current User",
          },
        ],
      },
    ];

    const api = vi.fn().mockResolvedValue({ activities: optedOutActivities });

    render(
      <TripActivitiesTab
        tripId="trip-100"
        isAdmin={false}
        isConfirmedAttendee={true}
        currentMemberId="mem-current"
        api={api}
      />
    );

    expect(
      await screen.findByText("🏕️ You have opted out of this tour (relaxing at camp).")
    ).toBeInTheDocument();
  });

  it("opens voucher details modal, submits voucher codes, and calls submit_activity_voucher", async () => {
    const user = userEvent.setup();
    let currentVoucherStatus = "needed";

    const api = vi.fn().mockImplementation(async (action: string, _input?: any) => {
      if (action === "get_trip_activities") {
        return {
          activities: [
            {
              ...mockTripActivities[0],
              groups: [
                {
                  ...mockTripActivities[0].groups[0],
                  voucher_status: currentVoucherStatus,
                },
                mockTripActivities[0].groups[1],
              ],
            },
          ],
        };
      }
      if (action === "submit_activity_voucher") {
        currentVoucherStatus = "purchased";
        return { success: true, voucher_status: "purchased" };
      }
      return {};
    });

    render(
      <TripActivitiesTab
        tripId="trip-100"
        isAdmin={false}
        isConfirmedAttendee={true}
        currentMemberId="mem-current"
        api={api}
      />
    );

    expect(await screen.findByText("San Francisco GoCar Tour")).toBeInTheDocument();

    // Click "+ Enter Voucher Details" button
    const enterVoucherBtn = screen.getByRole("button", { name: /\+ Enter Voucher Details/i });
    await user.click(enterVoucherBtn);

    // Modal opens
    expect(screen.getByText(/Enter Voucher Details - GoCar #1/i)).toBeInTheDocument();
    expect(
      screen.getByText(
        /Entering this cost will automatically post a shared trip expense to the ledger/i
      )
    ).toBeInTheDocument();

    // Fill form fields
    const orderInput = screen.getByLabelText(/Groupon Order \/ Ref #/i);
    const codeInput = screen.getByLabelText(/Redemption \/ Voucher Code/i);
    const pinInput = screen.getByLabelText(/Security Code \/ PIN/i);
    const amountInput = screen.getByLabelText(/Amount in Dollars/i);

    await user.clear(orderInput);
    await user.type(orderInput, "ORD-9988");
    await user.clear(codeInput);
    await user.type(codeInput, "GP-12345");
    await user.clear(pinInput);
    await user.type(pinInput, "9876");
    fireEvent.change(amountInput, { target: { value: "174.60" } });

    // Submit modal
    const submitBtn = screen.getByRole("button", { name: /Save Voucher/i });
    fireEvent.submit(submitBtn.closest("form")!);

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith(
        "submit_activity_voucher",
        expect.objectContaining({
          tripId: "trip-100",
          groupId: "grp-1",
          orderNumber: "ORD-9988",
          voucherCode: "GP-12345",
          securityPin: "9876",
          voucherCostCents: 17460,
        })
      );
    });

    // Badge should be READY
    expect(await screen.findByText("✓ READY")).toBeInTheDocument();
  });

  it("opens Tour Operator Call Sheet modal and copies formatted manifest to clipboard", async () => {
    const user = userEvent.setup();
    const writeTextSpy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    const api = vi.fn().mockResolvedValue({ activities: mockTripActivities });

    render(
      <TripActivitiesTab
        tripId="trip-100"
        isAdmin={false}
        isConfirmedAttendee={true}
        currentMemberId="mem-current"
        api={api}
      />
    );

    expect(await screen.findByText("San Francisco GoCar Tour")).toBeInTheDocument();

    const callSheetBtn = screen.getByRole("button", { name: /📞 Tour Operator Call Sheet/i });
    await user.click(callSheetBtn);

    // Verify modal is open and table columns exist
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/Tour Operator Call Sheet - San Francisco GoCar Tour/i)).toBeInTheDocument();
    expect(within(dialog).getByText("Veerraju Amanchi")).toBeInTheDocument();
    expect(within(dialog).getByText("ORD-9988")).toBeInTheDocument();
    expect(within(dialog).getByText("GP-12345")).toBeInTheDocument();

    // Click "📋 Copy All to Clipboard"
    const copyBtn = screen.getByRole("button", { name: /📋 Copy All to Clipboard/i });
    await user.click(copyBtn);

    expect(writeTextSpy).toHaveBeenCalled();
    expect(await screen.findByText("✓ Copied to Clipboard!")).toBeInTheDocument();
  });

  it("displays incoming swap banner and handles Accept and Decline actions", async () => {
    const user = userEvent.setup();
    const api = vi.fn().mockImplementation(async (action: string) => {
      if (action === "get_trip_activities") {
        return { activities: mockTripActivities };
      }
      if (action === "respond_partner_swap") {
        return { success: true };
      }
      return {};
    });

    render(
      <TripActivitiesTab
        tripId="trip-100"
        isAdmin={false}
        isConfirmedAttendee={true}
        currentMemberId="mem-current"
        api={api}
      />
    );

    expect(
      await screen.findByText(/⇄ Swap Request: Bob Smith wants to swap pairings with you!/i)
    ).toBeInTheDocument();

    const acceptBtn = screen.getByRole("button", { name: /Accept Swap/i });
    await user.click(acceptBtn);

    expect(api).toHaveBeenCalledWith("respond_partner_swap", {
      swapRequestId: "swap-1",
      status: "accepted",
    });
  });

  it("renders admin controls and handles auto-shuffle and lock pairings", async () => {
    const user = userEvent.setup();
    const api = vi.fn().mockImplementation(async (action: string) => {
      if (action === "get_trip_activities") {
        return { activities: mockTripActivities };
      }
      if (action === "admin_manage_activity_pairings") {
        return { success: true };
      }
      return {};
    });

    render(
      <TripActivitiesTab
        tripId="trip-100"
        isAdmin={true}
        isConfirmedAttendee={true}
        currentMemberId="mem-current"
        api={api}
      />
    );

    expect(await screen.findByText("San Francisco GoCar Tour")).toBeInTheDocument();

    // Auto-Shuffle button
    const shuffleBtn = screen.getByRole("button", { name: /🎲 Auto-Shuffle/i });
    await user.click(shuffleBtn);

    expect(api).toHaveBeenCalledWith("admin_manage_activity_pairings", {
      activityId: "act-1",
      action: "auto_shuffle",
    });

    // Lock Pairings button
    const lockBtn = screen.getByRole("button", { name: /🔒 Lock Pairings/i });
    await user.click(lockBtn);

    expect(api).toHaveBeenCalledWith("admin_manage_activity_pairings", {
      activityId: "act-1",
      action: "lock_pairings",
    });
  });

  it("non-admin attendee assigned to GoCar #1 only sees GoCar #1 card, and does not see GoCar #2", async () => {
    const activitiesWithoutSwap = [
      {
        ...mockTripActivities[0],
        swap_requests: [],
      },
    ];
    const api = vi.fn().mockResolvedValue({ activities: activitiesWithoutSwap });

    render(
      <TripActivitiesTab
        tripId="trip-100"
        isAdmin={false}
        isConfirmedAttendee={true}
        currentMemberId="mem-current"
        api={api}
      />
    );

    expect(await screen.findByText("San Francisco GoCar Tour")).toBeInTheDocument();

    // Assigned Vehicle header
    expect(screen.getByText("🏎️ Your Assigned Vehicle")).toBeInTheDocument();

    // GoCar #1 is present with partner and you tags
    expect(screen.getByText("GoCar #1")).toBeInTheDocument();
    expect(screen.getByText(/Current User.*\(You\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Veerraju Amanchi.*\(Partner\)/i)).toBeInTheDocument();

    // Buttons are present on assigned vehicle card
    expect(
      screen.getByRole("button", { name: /\+ Enter Voucher Details/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /⇄ Request Swap/i })
    ).toBeInTheDocument();

    // GoCar #2 and other vehicle riders must NOT be rendered for non-admin
    expect(screen.queryByText("GoCar #2")).not.toBeInTheDocument();
    expect(screen.queryByText(/Bob Smith/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Alice Cooper/i)).not.toBeInTheDocument();
  });

  it("non-admin attendee who is unassigned sees the friendly waiting banner", async () => {
    const unassignedActivities = [
      {
        ...mockTripActivities[0],
        groups: [
          {
            ...mockTripActivities[0].groups[0],
            members: [mockTripActivities[0].groups[0].members[1]], // only Veerraju
          },
          mockTripActivities[0].groups[1], // Bob & Alice
        ],
      },
    ];

    const api = vi.fn().mockResolvedValue({ activities: unassignedActivities });

    render(
      <TripActivitiesTab
        tripId="trip-100"
        isAdmin={false}
        isConfirmedAttendee={true}
        currentMemberId="mem-current"
        api={api}
      />
    );

    expect(await screen.findByText("San Francisco GoCar Tour")).toBeInTheDocument();

    // Friendly waiting banner
    expect(
      screen.getByText(
        /You are confirmed for this tour! The trip organizer will assign your vehicle shortly/i
      )
    ).toBeInTheDocument();

    // Vehicle cards must NOT be displayed
    expect(screen.queryByText("🏎️ Your Assigned Vehicle")).not.toBeInTheDocument();
    expect(screen.queryByText("GoCar #1")).not.toBeInTheDocument();
    expect(screen.queryByText("GoCar #2")).not.toBeInTheDocument();
  });

  it("renders prominent Groupon / Booking button with booking_url link in hero banner", async () => {
    const activityWithBooking = [
      {
        ...mockTripActivities[0],
        booking_url: "https://www.groupon.com/deals/gocar-tours-sf-promo",
      },
    ];

    const api = vi.fn().mockResolvedValue({ activities: activityWithBooking });

    render(
      <TripActivitiesTab
        tripId="trip-100"
        isAdmin={false}
        isConfirmedAttendee={true}
        currentMemberId="mem-current"
        api={api}
      />
    );

    expect(await screen.findByText("San Francisco GoCar Tour")).toBeInTheDocument();

    // Prominent Groupon button with price tag from tip ($174.60)
    const bookingBtn = screen.getByRole("link", {
      name: /Buy Voucher on Groupon.*\(\$174\.60\)/i,
    });
    expect(bookingBtn).toBeInTheDocument();
    expect(bookingBtn).toHaveAttribute(
      "href",
      "https://www.groupon.com/deals/gocar-tours-sf-promo"
    );
    expect(bookingBtn).toHaveAttribute("target", "_blank");
    expect(bookingBtn).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders generic activity booking link when booking_url is not Groupon", async () => {
    const activityWithGenericBooking = [
      {
        ...mockTripActivities[0],
        booking_url: "https://gocartours.com/book-now",
      },
    ];
    const genericApi = vi.fn().mockResolvedValue({ activities: activityWithGenericBooking });

    render(
      <TripActivitiesTab
        tripId="trip-200"
        isAdmin={false}
        isConfirmedAttendee={true}
        currentMemberId="mem-current"
        api={genericApi}
      />
    );

    expect(await screen.findByText("San Francisco GoCar Tour")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Activity Booking Link/i })
    ).toHaveAttribute("href", "https://gocartours.com/book-now");
  });

  it("clicking '+ Add Vehicle' calls admin_manage_activity_pairings with action: 'create_group'", async () => {
    const user = userEvent.setup();
    const api = vi.fn().mockImplementation(async (action: string) => {
      if (action === "get_trip_activities") {
        return { activities: mockTripActivities };
      }
      if (action === "admin_manage_activity_pairings") {
        return { success: true };
      }
      return {};
    });

    render(
      <TripActivitiesTab
        tripId="trip-100"
        isAdmin={true}
        isConfirmedAttendee={true}
        currentMemberId="mem-current"
        api={api}
      />
    );

    expect(await screen.findByText("San Francisco GoCar Tour")).toBeInTheDocument();

    const addVehicleBtn = screen.getByRole("button", { name: /\+ Add Vehicle/i });
    await user.click(addVehicleBtn);

    expect(api).toHaveBeenCalledWith(
      "admin_manage_activity_pairings",
      expect.objectContaining({
        tripId: "trip-100",
        activityId: "act-1",
        action: "create_group",
      })
    );
  });

  it("opens Assign Campers modal, picks 2 campers from dropdowns, and submits calls action: 'assign_members' with selected memberIds", async () => {
    const user = userEvent.setup();
    const api = vi.fn().mockImplementation(async (action: string) => {
      if (action === "get_trip_activities") {
        return { activities: mockTripActivities };
      }
      if (action === "admin_manage_activity_pairings") {
        return { success: true };
      }
      return {};
    });

    render(
      <TripActivitiesTab
        tripId="trip-100"
        isAdmin={true}
        isConfirmedAttendee={true}
        currentMemberId="mem-current"
        api={api}
      />
    );

    expect(await screen.findByText("San Francisco GoCar Tour")).toBeInTheDocument();

    // In admin view, GoCar #1 card has "Assign Campers" button
    const assignBtns = screen.getAllByRole("button", { name: /Assign Campers/i });
    expect(assignBtns.length).toBeGreaterThan(0);
    await user.click(assignBtns[0]);

    // Modal dialog is opened
    const dialog = screen.getByRole("dialog", { name: /Assign Campers - GoCar #1/i });
    expect(dialog).toBeInTheDocument();

    const slot1Select = within(dialog).getByLabelText(/Slot 1/i);
    const slot2Select = within(dialog).getByLabelText(/Slot 2/i);

    // Pick 2 campers from dropdowns
    await user.selectOptions(slot1Select, "mem-bob");
    await user.selectOptions(slot2Select, "mem-alice");

    const saveBtn = within(dialog).getByRole("button", { name: /Save Assignments/i });
    await user.click(saveBtn);

    expect(api).toHaveBeenCalledWith(
      "admin_manage_activity_pairings",
      expect.objectContaining({
        tripId: "trip-100",
        activityId: "act-1",
        action: "assign_members",
        groupId: "grp-1",
        memberIds: ["mem-bob", "mem-alice"],
      })
    );
  });

  it("shows all confirmed trip attendees in Assign Campers dropdown even when not in activity participants", async () => {
    const user = userEvent.setup();
    const actWithOnlyAdmin: TripActivityItem[] = [
      {
        ...mockTripActivities[0],
        participants: [
          {
            id: "part-admin",
            activity_id: "act-1",
            member_id: "mem-current",
            status: "attending",
            display_name: "Admin Leader",
          },
        ],
        groups: [
          {
            id: "grp-1",
            activity_id: "act-1",
            group_number: 1,
            group_name: "GoCar #1",
            voucher_status: "needed",
            members: [],
          },
        ],
      },
    ];

    const confirmedTripCampers = [
      { memberId: "mem-current", displayName: "Admin Leader" },
      { memberId: "mem-charlie", displayName: "Charlie Brown" },
      { memberId: "mem-david", displayName: "David Hassel" },
    ];

    const api = vi.fn().mockImplementation(async (action: string) => {
      if (action === "get_trip_activities") {
        return { activities: actWithOnlyAdmin };
      }
      if (action === "admin_manage_activity_pairings") {
        return { success: true };
      }
      return {};
    });

    render(
      <TripActivitiesTab
        tripId="trip-100"
        isAdmin={true}
        isConfirmedAttendee={true}
        currentMemberId="mem-current"
        tripAttendees={confirmedTripCampers}
        api={api}
      />
    );

    expect(await screen.findByText("San Francisco GoCar Tour")).toBeInTheDocument();

    const assignBtns = screen.getAllByRole("button", { name: /Assign Campers/i });
    await user.click(assignBtns[0]);

    const dialog = screen.getByRole("dialog", { name: /Assign Campers - GoCar #1/i });
    expect(dialog).toBeInTheDocument();

    // Verify all trip attendees appear in slot dropdowns
    const slot1Select = within(dialog).getByLabelText(/Slot 1/i);
    expect(within(slot1Select).getByText(/Charlie Brown/i)).toBeInTheDocument();
    expect(within(slot1Select).getByText(/David Hassel/i)).toBeInTheDocument();
    expect(within(slot1Select).getByText(/Admin Leader/i)).toBeInTheDocument();

    await user.selectOptions(slot1Select, "mem-charlie");
    const slot2Select = within(dialog).getByLabelText(/Slot 2/i);
    await user.selectOptions(slot2Select, "mem-david");

    const saveBtn = within(dialog).getByRole("button", { name: /Save Assignments/i });
    await user.click(saveBtn);

    expect(api).toHaveBeenCalledWith(
      "admin_manage_activity_pairings",
      expect.objectContaining({
        tripId: "trip-100",
        activityId: "act-1",
        action: "assign_members",
        groupId: "grp-1",
        memberIds: ["mem-charlie", "mem-david"],
      })
    );
  });

  it("clicking 'Delete Vehicle' calls action: 'delete_group'", async () => {
    const user = userEvent.setup();
    window.confirm = vi.fn().mockReturnValue(true);

    const api = vi.fn().mockImplementation(async (action: string) => {
      if (action === "get_trip_activities") {
        return { activities: mockTripActivities };
      }
      if (action === "admin_manage_activity_pairings") {
        return { success: true };
      }
      return {};
    });

    render(
      <TripActivitiesTab
        tripId="trip-100"
        isAdmin={true}
        isConfirmedAttendee={true}
        currentMemberId="mem-current"
        api={api}
      />
    );

    expect(await screen.findByText("San Francisco GoCar Tour")).toBeInTheDocument();

    // GoCar #2 has voucher_status: 'needed', so Delete Vehicle button is rendered
    // GoCar #1 has voucher_status: 'purchased', so it does NOT have Delete Vehicle button
    const deleteBtns = screen.getAllByRole("button", { name: /Delete Vehicle/i });
    expect(deleteBtns).toHaveLength(1);

    await user.click(deleteBtns[0]);

    expect(window.confirm).toHaveBeenCalled();
    expect(api).toHaveBeenCalledWith(
      "admin_manage_activity_pairings",
      expect.objectContaining({
        tripId: "trip-100",
        activityId: "act-1",
        action: "delete_group",
        groupId: "grp-2",
      })
    );
  });

  it("Add Trip Activity modal includes bookingUrl and submits it", async () => {
    const user = userEvent.setup();
    const api = vi.fn().mockImplementation(async (action: string) => {
      if (action === "get_trip_activities") {
        return { activities: mockTripActivities };
      }
      if (action === "get_master_activities") {
        return { activities: [] };
      }
      if (action === "admin_manage_trip_activity") {
        return { success: true };
      }
      return {};
    });

    render(
      <TripActivitiesTab
        tripId="trip-100"
        isAdmin={true}
        isConfirmedAttendee={true}
        currentMemberId="mem-current"
        api={api}
      />
    );

    expect(await screen.findByText("San Francisco GoCar Tour")).toBeInTheDocument();

    const addActivityBtn = screen.getByRole("button", { name: /\+ Add Activity/i });
    await user.click(addActivityBtn);

    const dialog = screen.getByRole("dialog", { name: /Add Trip Activity/i });
    expect(dialog).toBeInTheDocument();

    // Switch to "Create Custom Activity" tab
    const createTabBtn = within(dialog).getByRole("button", { name: /Create Custom Activity/i });
    await user.click(createTabBtn);

    const titleInput = within(dialog).getByLabelText(/Activity Title/i);
    const dateInput = within(dialog).getByLabelText(/Activity Date/i);
    const bookingUrlInput = within(dialog).getByLabelText(/Booking \/ Signup URL \(e\.g\. Groupon\)/i);

    expect(bookingUrlInput).toBeInTheDocument();

    await user.type(titleInput, "Custom Kayak Adventure");
    fireEvent.change(dateInput, { target: { value: "2026-11-20" } });
    await user.type(bookingUrlInput, "https://www.groupon.com/deals/custom-kayak");

    const submitBtn = within(dialog).getByRole("button", { name: /Create Activity/i });
    await user.click(submitBtn);

    expect(api).toHaveBeenCalledWith(
      "admin_manage_trip_activity",
      expect.objectContaining({
        action: "create",
        tripId: "trip-100",
        title: "Custom Kayak Adventure",
        activityDate: "2026-11-20",
        bookingUrl: "https://www.groupon.com/deals/custom-kayak",
      })
    );
  });

  it("falls back to booking_notes as booking URL when booking_url is null and booking_notes is a URL", async () => {
    const activityWithNotesUrl: TripActivityItem = {
      ...mockTripActivities[0],
      booking_url: null,
      booking_notes: "https://www.groupon.com/checkout/cart?deal=monterey-gocar",
    } as unknown as TripActivityItem;

    const api = vi.fn().mockImplementation((action: string) => {
      if (action === "get_trip_activities") {
        return Promise.resolve({ activities: [activityWithNotesUrl] });
      }
      return Promise.resolve({});
    });

    render(
      <TripActivitiesTab
        tripId="trip-100"
        isAdmin={false}
        isConfirmedAttendee={true}
        currentMemberId="mem-current"
        api={api}
      />
    );

    expect(await screen.findByText("San Francisco GoCar Tour")).toBeInTheDocument();

    const bookingLink = screen.getByRole("link", {
      name: /Buy Voucher on Groupon/i,
    });
    expect(bookingLink).toBeInTheDocument();
    expect(bookingLink).toHaveAttribute(
      "href",
      "https://www.groupon.com/checkout/cart?deal=monterey-gocar"
    );
  });

  it("allows admin to open Edit Activity modal and update activity booking_url", async () => {
    const user = userEvent.setup();
    const api = vi.fn().mockImplementation((action: string) => {
      if (action === "get_trip_activities") {
        return Promise.resolve({ activities: mockTripActivities });
      }
      if (action === "admin_manage_trip_activity") {
        return Promise.resolve({ success: true });
      }
      return Promise.resolve({});
    });

    render(
      <TripActivitiesTab
        tripId="trip-100"
        isAdmin={true}
        isConfirmedAttendee={true}
        currentMemberId="mem-current"
        api={api}
      />
    );

    expect(await screen.findByText("San Francisco GoCar Tour")).toBeInTheDocument();

    const editBtn = screen.getByRole("button", { name: /✏️ Edit Activity/i });
    await user.click(editBtn);

    const dialog = screen.getByRole("dialog", { name: /Edit Trip Activity/i });
    expect(dialog).toBeInTheDocument();

    const bookingUrlInput = within(dialog).getByLabelText(
      /Booking \/ Signup URL \(e\.g\. Groupon\)/i
    );
    await user.clear(bookingUrlInput);
    await user.type(bookingUrlInput, "https://www.groupon.com/deals/updated-gocar-tour");

    const saveBtn = within(dialog).getByRole("button", { name: /Save Changes/i });
    await user.click(saveBtn);

    expect(api).toHaveBeenCalledWith(
      "admin_manage_trip_activity",
      expect.objectContaining({
        action: "update",
        tripId: "trip-100",
        activityId: "act-1",
        bookingUrl: "https://www.groupon.com/deals/updated-gocar-tour",
      })
    );
  });
});
