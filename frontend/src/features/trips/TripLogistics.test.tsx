import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TripLogisticsTab, type TripCommitment, type TripCarpool, type MemberReadiness } from "./TripLogisticsTab";

const mockCommitments: TripCommitment[] = [
  {
    id: "comm-1",
    tripId: "trip-1",
    category: "gear",
    itemName: "Propane 2-Burner Stove",
    quantityDescription: "2 burners + fuel",
    assignedMemberId: null,
    assignedMemberName: null,
    isCritical: true,
    isMine: false,
    createdAt: "2026-10-15T00:00:00Z",
    updatedAt: "2026-10-15T00:00:00Z",
  },
  {
    id: "comm-2",
    tripId: "trip-1",
    category: "food",
    itemName: "Saturday Morning Pancake Mix & Syrup",
    quantityDescription: "Serves 10",
    assignedMemberId: "member-1",
    assignedMemberName: "Dave K.",
    isCritical: false,
    isMine: true,
    createdAt: "2026-10-15T00:00:00Z",
    updatedAt: "2026-10-15T00:00:00Z",
  },
];

const mockCarpools: TripCarpool[] = [
  {
    id: "cp-1",
    tripId: "trip-1",
    driverMemberId: "member-2",
    driverName: "Sarah M.",
    vehicleDescription: "Silver Subaru Forester",
    maxSeats: 5,
    occupiedSeats: 3,
    availableSeats: 2,
    startingMileage: 45200.0,
    endingMileage: 45380.0,
    totalMiles: 180.0,
    departureDetails: "Leaving Friday 3:30 PM from Northgate",
    isMyCarpool: false,
    riders: [
      { id: "rider-1", riderMemberId: "member-1", displayName: "Dave K.", isMe: true },
      { id: "rider-2", riderMemberId: "member-3", displayName: "Tom W.", isMe: false },
    ],
  },
];

const mockMemberReadiness: MemberReadiness = {
  carpoolRole: "rider",
  carpoolDetails: "Riding with Sarah M. (Silver Subaru Forester)",
  myCommitmentsCount: 1,
  criticalMissingCount: 1,
  totalCarpoolsCount: 1,
};

describe("Phase 4: Trip Logistics, Commitments & Carpools", () => {
  it("renders critical items missing alert banner and commitment list", async () => {
    const mockApi = vi.fn().mockImplementation((action: string) => {
      if (action === "get_trip_logistics") {
        return Promise.resolve({
          commitments: mockCommitments,
          carpools: mockCarpools,
          memberReadiness: mockMemberReadiness,
        });
      }
      return Promise.resolve({});
    });

    render(
      <TripLogisticsTab
        tripId="trip-1"
        isConfirmedAttendee={true}
        isAdmin={false}
        currentMemberId="member-1"
        api={mockApi}
      />
    );

    // Critical missing banner should be displayed
    expect(await screen.findByText(/1 Critical Items Missing:/i)).toBeInTheDocument();

    // Items rendered
    expect(screen.getByText("Propane 2-Burner Stove")).toBeInTheDocument();
    expect(screen.getByText("Saturday Morning Pancake Mix & Syrup")).toBeInTheDocument();

    // Critical badge
    expect(screen.getByText(/🚨 Critical Item/i)).toBeInTheDocument();
  });

  it("allows confirmed member to claim an unclaimed commitment item", async () => {
    const user = userEvent.setup();
    const mockApi = vi.fn().mockImplementation((action: string) => {
      if (action === "get_trip_logistics") {
        return Promise.resolve({
          commitments: mockCommitments,
          carpools: mockCarpools,
          memberReadiness: mockMemberReadiness,
        });
      }
      if (action === "manage_trip_commitment") {
        return Promise.resolve({ success: true, action: "claim" });
      }
      return Promise.resolve({});
    });

    render(
      <TripLogisticsTab
        tripId="trip-1"
        isConfirmedAttendee={true}
        isAdmin={false}
        currentMemberId="member-1"
        api={mockApi}
      />
    );

    const claimBtn = await screen.findByRole("button", { name: /✓ I'll Bring This/i });
    expect(claimBtn).toBeInTheDocument();

    await user.click(claimBtn);

    expect(mockApi).toHaveBeenCalledWith(
      "manage_trip_commitment",
      expect.objectContaining({
        tripId: "trip-1",
        action: "claim",
        commitmentId: "comm-1",
      })
    );
  });

  it("allows member to unclaim an item they previously claimed", async () => {
    const user = userEvent.setup();
    const mockApi = vi.fn().mockImplementation((action: string) => {
      if (action === "get_trip_logistics") {
        return Promise.resolve({
          commitments: mockCommitments,
          carpools: mockCarpools,
          memberReadiness: mockMemberReadiness,
        });
      }
      if (action === "manage_trip_commitment") {
        return Promise.resolve({ success: true, action: "unclaim" });
      }
      return Promise.resolve({});
    });

    render(
      <TripLogisticsTab
        tripId="trip-1"
        isConfirmedAttendee={true}
        isAdmin={false}
        currentMemberId="member-1"
        api={mockApi}
      />
    );

    const unclaimBtn = await screen.findByRole("button", { name: /Unclaim/i });
    expect(unclaimBtn).toBeInTheDocument();

    await user.click(unclaimBtn);

    expect(mockApi).toHaveBeenCalledWith(
      "manage_trip_commitment",
      expect.objectContaining({
        tripId: "trip-1",
        action: "unclaim",
        commitmentId: "comm-2",
      })
    );
  });

  it("displays carpools with driver, riders, and recorded mileage", async () => {
    const mockApi = vi.fn().mockImplementation((action: string) => {
      if (action === "get_trip_logistics") {
        return Promise.resolve({
          commitments: mockCommitments,
          carpools: mockCarpools,
          memberReadiness: mockMemberReadiness,
        });
      }
      return Promise.resolve({});
    });

    render(
      <TripLogisticsTab
        tripId="trip-1"
        isConfirmedAttendee={true}
        isAdmin={true}
        currentMemberId="member-1"
        api={mockApi}
      />
    );

    expect(await screen.findByRole("heading", { name: /Silver Subaru Forester/i })).toBeInTheDocument();
    expect(screen.getByText("Sarah M.")).toBeInTheDocument();
    expect(screen.getByText(/45200 mi/i)).toBeInTheDocument();
    expect(screen.getByText(/45380 mi/i)).toBeInTheDocument();
    expect(screen.getByText(/180 mi/i)).toBeInTheDocument();
    expect(screen.getByText(/Dave K. \(You\)/i)).toBeInTheDocument();
  });

  it("allows admin or driver to open odometer modal and submit mileage", async () => {
    const user = userEvent.setup();
    const mockApi = vi.fn().mockImplementation((action: string) => {
      if (action === "get_trip_logistics") {
        return Promise.resolve({
          commitments: mockCommitments,
          carpools: mockCarpools,
          memberReadiness: mockMemberReadiness,
        });
      }
      if (action === "record_carpool_mileage") {
        return Promise.resolve({ success: true });
      }
      return Promise.resolve({});
    });

    render(
      <TripLogisticsTab
        tripId="trip-1"
        isConfirmedAttendee={true}
        isAdmin={true}
        currentMemberId="member-1"
        api={mockApi}
      />
    );

    const mileageBtn = await screen.findByRole("button", { name: /📍 Odometer \/ Mileage/i });
    await user.click(mileageBtn);

    expect(screen.getByRole("heading", { name: /Record Carpool Mileage/i })).toBeInTheDocument();

    const form = screen.getByRole("heading", { name: /Record Carpool Mileage/i }).parentElement!.querySelector("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith(
        "record_carpool_mileage",
        expect.objectContaining({
          tripId: "trip-1",
          carpoolId: "cp-1",
          startingMileage: 45200,
          endingMileage: 45380,
        })
      );
    });
  });

  it("displays $0.50/mi mileage reimbursement text and small-carpool collaboration disclaimer", async () => {
    const mockApi = vi.fn().mockImplementation((action: string) => {
      if (action === "get_trip_logistics") {
        return Promise.resolve({
          commitments: mockCommitments,
          carpools: [],
          memberReadiness: mockMemberReadiness,
        });
      }
      return Promise.resolve({});
    });

    render(
      <TripLogisticsTab
        tripId="trip-1"
        isConfirmedAttendee={true}
        isAdmin={false}
        currentMemberId="member-1"
        api={mockApi}
      />
    );

    expect(
      await screen.findByText(/post-trip reimbursement \(\$0\.50\/mi for 3\+ passengers\)/i)
    ).toBeInTheDocument();

    expect(
      screen.getByText(
        /disclaimer: for carpools with fewer than 3 passengers, riders can collaborate to share the vehicle expenses directly between themselves/i
      )
    ).toBeInTheDocument();
  });
});
