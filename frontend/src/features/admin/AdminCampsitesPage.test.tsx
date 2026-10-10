import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { AdminCampsitesPage, type Campsite } from "./AdminCampsitesPage";
import { TripApiError } from "../../lib/supabase";

const mockCampsites: Campsite[] = [
  {
    campsiteId: "site-1",
    name: "Del Monte",
    locationDescription: "Monterey, CA",
    availabilityUrl: "https://example.com/del-monte",
    directions: "Hwy 1 south",
    cabinCapacity: 8,
    cabinTypes: ["cabin"],
    reservationInstructions: "Call host",
    estimatedRateCents: 25000,
    availabilityStatus: "available",
    availabilitySourceUrl: null,
    imageUrl: "https://example.com/delmonte.jpg",
    campHostName: "John Doe",
    campHostPhone: "555-1234",
    campFeatures: ["Fire pit", "Lake view"],
    cabinInformation: "2 queen beds, kitchenette",
    adminNotes: "Preferred site",
    version: 1,
  },
];

describe("AdminCampsitesPage", () => {
  it("renders campsite directory and displays campsite details", async () => {
    const api = vi.fn(async (action: string) => {
      if (action === "get_calendar") {
        return { campsites: mockCampsites };
      }
      return {};
    });

    render(
      <MemoryRouter>
        <AdminCampsitesPage api={api as any} />
      </MemoryRouter>
    );

    expect(await screen.findByText("Del Monte")).toBeInTheDocument();
    expect(screen.getByText("Monterey, CA")).toBeInTheDocument();
    expect(screen.getByText(/John Doe/)).toBeInTheDocument();
    expect(screen.getByText(/555-1234/)).toBeInTheDocument();
    expect(screen.getByText("Fire pit")).toBeInTheDocument();
    expect(screen.getByText("Lake view")).toBeInTheDocument();
    expect(screen.getByText(/2 queen beds, kitchenette/)).toBeInTheDocument();
  });

  it("handles loading error gracefully", async () => {
    const api = vi.fn(async () => {
      throw new Error("Network error");
    });

    render(
      <MemoryRouter>
        <AdminCampsitesPage api={api as any} />
      </MemoryRouter>
    );

    expect(await screen.findByText("Could not load campsites.")).toBeInTheDocument();
  });

  it("allows opening Add Campsite modal and submits admin_create_campsite", async () => {
    const user = userEvent.setup();
    const api = vi.fn(async (action: string) => {
      if (action === "get_calendar") {
        return { campsites: mockCampsites };
      }
      if (action === "admin_create_campsite") {
        return { success: true };
      }
      return {};
    });

    render(
      <MemoryRouter>
        <AdminCampsitesPage api={api as any} />
      </MemoryRouter>
    );

    await screen.findByText("Del Monte");
    await user.click(screen.getByRole("button", { name: "+ Add Campsite" }));

    expect(screen.getByText("Add New Campsite")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Campsite Name *"), "Wishon Cove");
    await user.type(screen.getByLabelText("Campsite Address *"), "Shaver Lake, CA");
    await user.type(screen.getByLabelText("Image URL"), "https://example.com/wishon.jpg");
    await user.type(screen.getByLabelText("Camp Host Name"), "Jane Smith");
    await user.type(screen.getByLabelText("Camp Host Phone"), "555-9876");
    await user.type(screen.getByLabelText("Camp Features (comma-separated)"), "Showers, Boating");
    await user.type(screen.getByLabelText("Cabin Information"), "Rustic bunkhouse");

    await user.click(screen.getByRole("button", { name: "Create Campsite" }));

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith(
        "admin_create_campsite",
        expect.objectContaining({
          name: "Wishon Cove",
          locationDescription: "Shaver Lake, CA",
          imageUrl: "https://example.com/wishon.jpg",
          campHostName: "Jane Smith",
          campHostPhone: "555-9876",
          campFeatures: ["Showers", "Boating"],
          cabinInformation: "Rustic bunkhouse",
        })
      );
    });
  });

  it("allows editing an existing campsite and submits admin_update_campsite", async () => {
    const user = userEvent.setup();
    const api = vi.fn(async (action: string) => {
      if (action === "get_calendar") {
        return { campsites: mockCampsites };
      }
      if (action === "admin_update_campsite") {
        return { success: true };
      }
      return {};
    });

    render(
      <MemoryRouter>
        <AdminCampsitesPage api={api as any} />
      </MemoryRouter>
    );

    await screen.findByText("Del Monte");
    await user.click(screen.getByRole("button", { name: "✏️ Edit" }));

    expect(screen.getByText("Edit Del Monte")).toBeInTheDocument();

    const nameInput = screen.getByLabelText("Campsite Name *");
    expect(nameInput).toHaveValue("Del Monte");

    await user.clear(nameInput);
    await user.type(nameInput, "Del Monte Beach");

    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith(
        "admin_update_campsite",
        expect.objectContaining({
          campsiteId: "site-1",
          expectedVersion: 1,
          name: "Del Monte Beach",
          locationDescription: "Monterey, CA",
        })
      );
    });
  });

  it("displays error message when saving campsite fails", async () => {
    const user = userEvent.setup();
    const api = vi.fn(async (action: string) => {
      if (action === "get_calendar") {
        return { campsites: mockCampsites };
      }
      if (action === "admin_create_campsite") {
        throw new TripApiError("Invalid input", 400);
      }
      return {};
    });

    render(
      <MemoryRouter>
        <AdminCampsitesPage api={api as any} />
      </MemoryRouter>
    );

    await screen.findByText("Del Monte");
    await user.click(screen.getByRole("button", { name: "+ Add Campsite" }));
    await user.type(screen.getByLabelText("Campsite Name *"), "Invalid Site");
    await user.type(screen.getByLabelText("Campsite Address *"), "Somewhere");
    await user.click(screen.getByRole("button", { name: "Create Campsite" }));

    expect(await screen.findByText("Could not save campsite. Verify input values.")).toBeInTheDocument();
  });
});
