import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  MasterActivitiesTab,
  type MasterActivityItem,
} from "./MasterActivitiesTab";

const mockActivities: MasterActivityItem[] = [
  {
    id: "act-1",
    title: "GoCar Tour Monterey",
    category: "tour",
    image_url: "https://example.com/gocar.jpg",
    location_name: "Cannery Row Rentals",
    address: "700 Cannery Row, Monterey, CA 93940",
    directions_url: "https://maps.google.com/?q=cannery+row",
    unit_label: "GoCar",
    unit_capacity: 2,
    booking_notes: "Groupon voucher covers 2 hours. Bring sunglasses and valid driver license.",
    is_active: true,
    created_at: "2026-10-10T00:00:00Z",
    updated_at: "2026-10-10T00:00:00Z",
  },
  {
    id: "act-2",
    title: "Elkhorn Slough Kayaking",
    category: "water",
    image_url: null,
    location_name: "Moss Landing Harbor",
    address: "Highway 1, Moss Landing, CA 95039",
    directions_url: "https://maps.google.com/?q=moss+landing",
    unit_label: "Kayak",
    unit_capacity: 1,
    booking_notes: "High tide at 11am. Sea otters guaranteed.",
    is_active: true,
    created_at: "2026-10-10T00:00:00Z",
    updated_at: "2026-10-10T00:00:00Z",
  },
  {
    id: "act-3",
    title: "Pinnacles High Peaks Hike",
    category: "outdoor",
    image_url: "https://example.com/pinnacles.jpg",
    location_name: "Bear Gulch Day Use",
    address: "Pinnacles National Park East Entrance",
    directions_url: null,
    unit_label: "Vehicle",
    unit_capacity: 4,
    booking_notes: "National Park Pass required per vehicle.",
    is_active: false,
    created_at: "2026-10-10T00:00:00Z",
    updated_at: "2026-10-10T00:00:00Z",
  },
];

describe("MasterActivitiesTab", () => {
  it("renders activity template cards with title, category, unit capacity badge, location, and booking notes", async () => {
    const api = vi.fn().mockImplementation((action: string) => {
      if (action === "get_master_activities") {
        return Promise.resolve({ activities: mockActivities });
      }
      return Promise.reject(new Error(`unhandled: ${action}`));
    });

    render(<MasterActivitiesTab api={api} />);

    await waitFor(() => {
      expect(screen.getByText("GoCar Tour Monterey")).toBeInTheDocument();
      expect(screen.getByText("Elkhorn Slough Kayaking")).toBeInTheDocument();
    });

    // Check badges within specific cards
    const gocarCard = screen.getByText("GoCar Tour Monterey").closest(".event-card") as HTMLElement;
    expect(within(gocarCard).getByText(/2 per GoCar/i)).toBeInTheDocument();
    expect(within(gocarCard).getByText(/🗺️ Tour/i)).toBeInTheDocument();

    const kayakCard = screen.getByText("Elkhorn Slough Kayaking").closest(".event-card") as HTMLElement;
    expect(within(kayakCard).getByText(/1 per Kayak/i)).toBeInTheDocument();
    expect(within(kayakCard).getByText(/🛶 Water/i)).toBeInTheDocument();

    // Check location & address
    expect(screen.getByText(/Cannery Row Rentals/i)).toBeInTheDocument();
    expect(screen.getByText(/700 Cannery Row/i)).toBeInTheDocument();

    // Check directions link
    const directionsLink = within(gocarCard).getByRole("link", { name: /directions/i });
    expect(directionsLink).toHaveAttribute("href", "https://maps.google.com/?q=cannery+row");

    // Check booking notes
    expect(screen.getByText(/Groupon voucher covers 2 hours/i)).toBeInTheDocument();

    // Check image preview
    const img = screen.getByAltText("GoCar Tour Monterey");
    expect(img).toHaveAttribute("src", "https://example.com/gocar.jpg");
  });

  it("filters activities in real-time by search query", async () => {
    const user = userEvent.setup();
    const api = vi.fn().mockResolvedValue({ activities: mockActivities });

    render(<MasterActivitiesTab api={api} />);

    await waitFor(() => expect(screen.getByText("GoCar Tour Monterey")).toBeInTheDocument());

    const searchInput = screen.getByPlaceholderText(/search activities/i);
    await user.type(searchInput, "kayak");

    expect(screen.queryByText("GoCar Tour Monterey")).not.toBeInTheDocument();
    expect(screen.getByText("Elkhorn Slough Kayaking")).toBeInTheDocument();

    await user.clear(searchInput);
    expect(screen.getByText("GoCar Tour Monterey")).toBeInTheDocument();
  });

  it("opens '+ Add Activity Template' modal, fills fields with live image preview, and submits create action", async () => {
    const user = userEvent.setup();
    let activitiesState = [...mockActivities];

    const api = vi.fn().mockImplementation((action: string, input: any) => {
      if (action === "get_master_activities") {
        return Promise.resolve({ activities: activitiesState });
      }
      if (action === "admin_manage_master_activity") {
        if (input.action === "create") {
          const created: MasterActivityItem = {
            id: "act-new",
            title: input.title,
            category: input.category,
            image_url: input.imageUrl ?? null,
            location_name: input.locationName ?? null,
            address: input.address ?? null,
            directions_url: input.directionsUrl ?? null,
            unit_label: input.unitLabel,
            unit_capacity: input.unitCapacity,
            booking_notes: input.bookingNotes ?? null,
            is_active: true,
            created_at: "2026-10-10T00:00:00Z",
            updated_at: "2026-10-10T00:00:00Z",
          };
          activitiesState = [...activitiesState, created];
          return Promise.resolve({ success: true, action: "create", id: created.id });
        }
      }
      return Promise.reject(new Error(`unhandled: ${action}`));
    });

    render(<MasterActivitiesTab api={api} />);

    await waitFor(() => expect(screen.getByText("GoCar Tour Monterey")).toBeInTheDocument());

    const addBtn = screen.getByRole("button", { name: /\+ add activity template/i });
    await user.click(addBtn);

    const modal = screen.getByRole("dialog", { name: /add activity template/i });
    expect(modal).toBeInTheDocument();

    // Fill form
    await user.type(within(modal).getByLabelText(/activity title/i), "ATV Dune Riding");
    await user.selectOptions(within(modal).getByLabelText(/category/i), "outdoor");
    await user.type(within(modal).getByLabelText(/image url/i), "https://example.com/atv.jpg");

    // Verify live preview renders
    expect(within(modal).getByAltText(/image preview/i)).toHaveAttribute(
      "src",
      "https://example.com/atv.jpg"
    );

    await user.type(within(modal).getByLabelText(/location name/i), "Oceano Dunes SVRA");
    await user.type(within(modal).getByLabelText(/physical address/i), "100 Pier Ave, Oceano, CA 93445");
    await user.type(within(modal).getByLabelText(/directions \/ map url/i), "https://maps.google.com/?q=oceano");
    await user.clear(within(modal).getByLabelText(/unit label/i));
    await user.type(within(modal).getByLabelText(/unit label/i), "ATV");
    await user.clear(within(modal).getByLabelText(/unit capacity/i));
    await user.type(within(modal).getByLabelText(/unit capacity/i), "1");
    await user.type(within(modal).getByLabelText(/booking notes/i), "Waiver must be signed online before arrival.");

    // Submit
    await user.click(within(modal).getByRole("button", { name: /save template/i }));

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith(
        "admin_manage_master_activity",
        expect.objectContaining({
          action: "create",
          title: "ATV Dune Riding",
          category: "outdoor",
          imageUrl: "https://example.com/atv.jpg",
          locationName: "Oceano Dunes SVRA",
          address: "100 Pier Ave, Oceano, CA 93445",
          directionsUrl: "https://maps.google.com/?q=oceano",
          unitLabel: "ATV",
          unitCapacity: 1,
          bookingNotes: "Waiver must be signed online before arrival.",
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByText("ATV Dune Riding")).toBeInTheDocument();
      expect(screen.getByText(/1 per ATV/i)).toBeInTheDocument();
    });
  });

  it("opens edit modal, modifies values, and saves update", async () => {
    const user = userEvent.setup();
    let activitiesState = [...mockActivities];

    const api = vi.fn().mockImplementation((action: string, input: any) => {
      if (action === "get_master_activities") {
        return Promise.resolve({ activities: activitiesState });
      }
      if (action === "admin_manage_master_activity") {
        if (input.action === "update") {
          activitiesState = activitiesState.map((a) =>
            a.id === input.id
              ? {
                  ...a,
                  title: input.title ?? a.title,
                  unit_capacity: input.unitCapacity ?? a.unit_capacity,
                  booking_notes: input.bookingNotes ?? a.booking_notes,
                }
              : a
          );
          return Promise.resolve({ success: true, action: "update", id: input.id });
        }
      }
      return Promise.reject(new Error(`unhandled: ${action}`));
    });

    render(<MasterActivitiesTab api={api} />);

    await waitFor(() => expect(screen.getByText("GoCar Tour Monterey")).toBeInTheDocument());

    const card = screen.getByText("GoCar Tour Monterey").closest(".event-card") as HTMLElement;
    const editBtn = within(card).getByRole("button", { name: /edit/i });
    await user.click(editBtn);

    const modal = screen.getByRole("dialog", { name: /edit activity template/i });
    expect(modal).toBeInTheDocument();

    const titleInput = within(modal).getByLabelText(/activity title/i);
    expect(titleInput).toHaveValue("GoCar Tour Monterey");

    await user.clear(within(modal).getByLabelText(/unit capacity/i));
    await user.type(within(modal).getByLabelText(/unit capacity/i), "3");

    await user.click(within(modal).getByRole("button", { name: /save template/i }));

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith(
        "admin_manage_master_activity",
        expect.objectContaining({
          action: "update",
          id: "act-1",
          unitCapacity: 3,
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByText(/3 per GoCar/i)).toBeInTheDocument();
    });
  });

  it("toggles active/inactive status via deactivate/reactivate button", async () => {
    const user = userEvent.setup();
    let activitiesState = [...mockActivities];

    const api = vi.fn().mockImplementation((action: string, input: any) => {
      if (action === "get_master_activities") {
        return Promise.resolve({ activities: activitiesState });
      }
      if (action === "admin_manage_master_activity") {
        if (input.action === "update") {
          activitiesState = activitiesState.map((a) =>
            a.id === input.id ? { ...a, is_active: input.isActive } : a
          );
          return Promise.resolve({ success: true, action: "update", id: input.id });
        }
      }
      return Promise.reject(new Error(`unhandled: ${action}`));
    });

    render(<MasterActivitiesTab api={api} />);

    await waitFor(() => expect(screen.getByText("GoCar Tour Monterey")).toBeInTheDocument());

    const card = screen.getByText("GoCar Tour Monterey").closest(".event-card") as HTMLElement;
    const deactivateBtn = within(card).getByRole("button", { name: /deactivate/i });
    await user.click(deactivateBtn);

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith(
        "admin_manage_master_activity",
        expect.objectContaining({
          action: "update",
          id: "act-1",
          isActive: false,
        })
      );
    });
  });

  it("opens delete confirmation modal and permanently deletes template", async () => {
    const user = userEvent.setup();
    let activitiesState = [...mockActivities];

    const api = vi.fn().mockImplementation((action: string, input: any) => {
      if (action === "get_master_activities") {
        return Promise.resolve({ activities: activitiesState });
      }
      if (action === "admin_manage_master_activity") {
        if (input.action === "delete") {
          activitiesState = activitiesState.filter((a) => a.id !== input.id);
          return Promise.resolve({ success: true, action: "delete", id: input.id });
        }
      }
      return Promise.reject(new Error(`unhandled: ${action}`));
    });

    render(<MasterActivitiesTab api={api} />);

    await waitFor(() => expect(screen.getByText("GoCar Tour Monterey")).toBeInTheDocument());

    const card = screen.getByText("GoCar Tour Monterey").closest(".event-card") as HTMLElement;
    const deleteBtn = within(card).getByRole("button", { name: /delete/i });
    await user.click(deleteBtn);

    const modal = screen.getByRole("dialog", { name: /delete activity template/i });
    expect(modal).toBeInTheDocument();
    expect(within(modal).getByText(/GoCar Tour Monterey/i)).toBeInTheDocument();

    const confirmBtn = within(modal).getByRole("button", { name: /confirm delete/i });
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith(
        "admin_manage_master_activity",
        expect.objectContaining({
          action: "delete",
          id: "act-1",
        })
      );
    });

    await waitFor(() => {
      expect(screen.queryByText("GoCar Tour Monterey")).not.toBeInTheDocument();
    });
  });

  it("handles broken image preview gracefully with placeholder fallback", async () => {
    const api = vi.fn().mockResolvedValue({ activities: mockActivities });

    render(<MasterActivitiesTab api={api} />);

    await waitFor(() => expect(screen.getByText("GoCar Tour Monterey")).toBeInTheDocument());

    const img = screen.getByAltText("GoCar Tour Monterey");
    // Trigger image load error
    fireEvent.error(img);

    // The image should be hidden and fallback visible
    expect(img).toHaveStyle({ display: "none" });
  });
});
