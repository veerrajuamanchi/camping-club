import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { MasterCatalogPage, type MasterCatalogsData } from "./MasterCatalogPage";

const mockCatalogs: MasterCatalogsData = {
  gear: [
    {
      id: "gear-1",
      name: "Sleeping Bag",
      description: "Warm down sleeping bag rated for 20F",
      gear_type: "individual",
      category: "sleep",
      default_quantity: "1",
      is_critical: true,
      active: true,
      created_at: "2026-10-10T00:00:00Z",
      updated_at: "2026-10-10T00:00:00Z",
    },
    {
      id: "gear-2",
      name: "Propane Camp Stove",
      description: "2-burner camping stove",
      gear_type: "shared",
      category: "kitchen",
      default_quantity: "2",
      is_critical: true,
      active: true,
      created_at: "2026-10-10T00:00:00Z",
      updated_at: "2026-10-10T00:00:00Z",
    },
    {
      id: "gear-3",
      name: "Headlamp",
      description: "LED headlamp with spare batteries",
      gear_type: "individual",
      category: "lighting",
      default_quantity: "1",
      is_critical: false,
      active: true,
      created_at: "2026-10-10T00:00:00Z",
      updated_at: "2026-10-10T00:00:00Z",
    },
  ],
  food: [
    {
      id: "food-1",
      name: "Pancake Mix",
      description: "Just add water buttermilk mix",
      category: "pantry",
      default_quantity: "2 boxes",
      is_critical: false,
      active: true,
      created_at: "2026-10-10T00:00:00Z",
      updated_at: "2026-10-10T00:00:00Z",
    },
    {
      id: "food-2",
      name: "Fresh Eggs",
      description: "Large brown pasture-raised eggs",
      category: "dairy_meat",
      default_quantity: "2 cartons",
      is_critical: true,
      active: true,
      created_at: "2026-10-10T00:00:00Z",
      updated_at: "2026-10-10T00:00:00Z",
    },
  ],
  responsibilities: [
    {
      id: "resp-1",
      title: "Campfire Setup",
      description: "Gather tinder and light evening campfire",
      category: "other",
      default_capacity: 2,
      workload_weight: 1.0,
      active: true,
      created_at: "2026-10-10T00:00:00Z",
      updated_at: "2026-10-10T00:00:00Z",
    },
  ],
  activities: [
    {
      id: "act-1",
      title: "GoCar Tour Monterey",
      category: "tour",
      image_url: null,
      location_name: "Cannery Row",
      address: "Monterey, CA",
      directions_url: null,
      unit_label: "GoCar",
      unit_capacity: 2,
      booking_notes: null,
      is_active: true,
      created_at: "2026-10-10T00:00:00Z",
      updated_at: "2026-10-10T00:00:00Z",
    },
  ],
};

describe("MasterCatalogPage", () => {
  it("renders tabs: Camping Gear, Food & Groceries, Responsibilities and displays items", async () => {
    const api = vi.fn().mockImplementation((action: string) => {
      if (action === "get_master_catalogs") {
        return Promise.resolve(mockCatalogs);
      }
      return Promise.reject(new Error(`unhandled: ${action}`));
    });

    render(
      <MemoryRouter>
        <MasterCatalogPage api={api} />
      </MemoryRouter>
    );

    expect(screen.getByRole("status")).toHaveTextContent(/loading/i);

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /camping gear/i })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: /food & groceries/i })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: /responsibilities/i })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: /activities/i })).toBeInTheDocument();
    });

    // Default tab is Camping Gear
    expect(screen.getByText("Sleeping Bag")).toBeInTheDocument();
    expect(screen.getByText("Propane Camp Stove")).toBeInTheDocument();
    expect(screen.getByText("Headlamp")).toBeInTheDocument();
  });

  it("filters visible items under Camping Gear using filter pills [All], [Individual], [Shared]", async () => {
    const user = userEvent.setup();
    const api = vi.fn().mockResolvedValue(mockCatalogs);

    render(
      <MemoryRouter>
        <MasterCatalogPage api={api} />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText("Sleeping Bag")).toBeInTheDocument());

    // Initially all 3 gear items are visible
    expect(screen.getByText("Sleeping Bag")).toBeInTheDocument();
    expect(screen.getByText("Propane Camp Stove")).toBeInTheDocument();
    expect(screen.getByText("Headlamp")).toBeInTheDocument();

    // Click [Shared] pill
    const sharedPill = screen.getByRole("button", { name: /shared/i });
    await user.click(sharedPill);

    expect(screen.queryByText("Sleeping Bag")).not.toBeInTheDocument();
    expect(screen.getByText("Propane Camp Stove")).toBeInTheDocument();
    expect(screen.queryByText("Headlamp")).not.toBeInTheDocument();

    // Click [Individual] pill
    const individualPill = screen.getByRole("button", { name: /individual/i });
    await user.click(individualPill);

    expect(screen.getByText("Sleeping Bag")).toBeInTheDocument();
    expect(screen.queryByText("Propane Camp Stove")).not.toBeInTheDocument();
    expect(screen.getByText("Headlamp")).toBeInTheDocument();

    // Click [All] pill
    const allPill = screen.getByRole("button", { name: /^all/i });
    await user.click(allPill);

    expect(screen.getByText("Sleeping Bag")).toBeInTheDocument();
    expect(screen.getByText("Propane Camp Stove")).toBeInTheDocument();
    expect(screen.getByText("Headlamp")).toBeInTheDocument();
  });

  it("filters item names in real-time when typing in search input", async () => {
    const user = userEvent.setup();
    const api = vi.fn().mockResolvedValue(mockCatalogs);

    render(
      <MemoryRouter>
        <MasterCatalogPage api={api} />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText("Sleeping Bag")).toBeInTheDocument());

    const searchInput = screen.getByPlaceholderText(/search/i);
    await user.type(searchInput, "propane");

    expect(screen.queryByText("Sleeping Bag")).not.toBeInTheDocument();
    expect(screen.getByText("Propane Camp Stove")).toBeInTheDocument();
    expect(screen.queryByText("Headlamp")).not.toBeInTheDocument();

    await user.clear(searchInput);
    expect(screen.getByText("Sleeping Bag")).toBeInTheDocument();
    expect(screen.getByText("Propane Camp Stove")).toBeInTheDocument();
  });

  it("switches tabs to Food & Groceries and Responsibilities", async () => {
    const user = userEvent.setup();
    const api = vi.fn().mockResolvedValue(mockCatalogs);

    render(
      <MemoryRouter>
        <MasterCatalogPage api={api} />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText("Sleeping Bag")).toBeInTheDocument());

    // Switch to Food & Groceries
    await user.click(screen.getByRole("tab", { name: /food & groceries/i }));
    expect(screen.getByText("Pancake Mix")).toBeInTheDocument();
    expect(screen.getByText("Fresh Eggs")).toBeInTheDocument();
    expect(screen.queryByText("Sleeping Bag")).not.toBeInTheDocument();

    // Switch to Responsibilities
    await user.click(screen.getByRole("tab", { name: /responsibilities/i }));
    expect(screen.getByText("Campfire Setup")).toBeInTheDocument();
    expect(screen.queryByText("Pancake Mix")).not.toBeInTheDocument();

    // Switch to Activities
    await user.click(screen.getByRole("tab", { name: /activities/i }));
    expect(screen.getByText("GoCar Tour Monterey")).toBeInTheDocument();
    expect(screen.getByText(/2 per GoCar/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /\+ add activity template/i })).toBeInTheDocument();
    expect(screen.queryByText("Campfire Setup")).not.toBeInTheDocument();
  });

  it("opens delete confirmation modal with safe unlinking explanation and sends delete action", async () => {
    const user = userEvent.setup();
    let catalogsState = { ...mockCatalogs };

    const api = vi.fn().mockImplementation((action: string, input: unknown) => {
      if (action === "get_master_catalogs") {
        return Promise.resolve(catalogsState);
      }
      if (action === "admin_manage_master_gear") {
        const payload = input as { action: string; id: string };
        if (payload.action === "delete") {
          catalogsState = {
            ...catalogsState,
            gear: catalogsState.gear.filter((g) => g.id !== payload.id),
          };
          return Promise.resolve({ success: true, deleted_id: payload.id });
        }
      }
      return Promise.reject(new Error(`unhandled: ${action}`));
    });

    render(
      <MemoryRouter>
        <MasterCatalogPage api={api} />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText("Propane Camp Stove")).toBeInTheDocument());

    // Find card for Propane Camp Stove
    const card = screen.getByText("Propane Camp Stove").closest(".event-card") as HTMLElement;
    const deleteBtn = within(card).getByRole("button", { name: /delete/i });
    await user.click(deleteBtn);

    // Confirmation modal should be visible
    const modal = screen.getByRole("dialog", { name: /delete master template/i });
    expect(modal).toBeInTheDocument();
    expect(within(modal).getByText(/Safe Unlinking Guarantee/i)).toBeInTheDocument();
    expect(within(modal).getByText(/snapshotted/i)).toBeInTheDocument();

    // Confirm deletion
    const confirmBtn = within(modal).getByRole("button", { name: /confirm delete/i });
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith(
        "admin_manage_master_gear",
        expect.objectContaining({
          action: "delete",
          id: "gear-2",
        })
      );
    });

    await waitFor(() => {
      expect(screen.queryByText("Propane Camp Stove")).not.toBeInTheDocument();
    });
  });

  it("allows adding a new master gear item via modal", async () => {
    const user = userEvent.setup();
    let catalogsState = { ...mockCatalogs };

    const api = vi.fn().mockImplementation((action: string, input: unknown) => {
      if (action === "get_master_catalogs") {
        return Promise.resolve(catalogsState);
      }
      if (action === "admin_manage_master_gear") {
        const payload = input as { action: string; name: string; gearType: string; category: string };
        if (payload.action === "create") {
          const newItem = {
            id: "gear-new",
            name: payload.name,
            description: "Test description",
            gear_type: payload.gearType as "individual" | "shared",
            category: payload.category as any,
            default_quantity: "1",
            is_critical: false,
            active: true,
            created_at: "2026-10-10T00:00:00Z",
            updated_at: "2026-10-10T00:00:00Z",
          };
          catalogsState = {
            ...catalogsState,
            gear: [...catalogsState.gear, newItem],
          };
          return Promise.resolve(newItem);
        }
      }
      return Promise.reject(new Error(`unhandled: ${action}`));
    });

    render(
      <MemoryRouter>
        <MasterCatalogPage api={api} />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText("Sleeping Bag")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /\+ add/i }));

    const modal = screen.getByRole("dialog", { name: /add master gear/i });
    expect(modal).toBeInTheDocument();

    await user.type(within(modal).getByLabelText(/item name/i), "Water Filter");
    await user.selectOptions(within(modal).getByLabelText(/gear type/i), "shared");
    await user.selectOptions(within(modal).getByLabelText(/category/i), "safety");

    await user.click(within(modal).getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith(
        "admin_manage_master_gear",
        expect.objectContaining({
          action: "create",
          name: "Water Filter",
          gearType: "shared",
          category: "safety",
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByText("Water Filter")).toBeInTheDocument();
    });
  });

  it("allows adding a new master food item via modal", async () => {
    const user = userEvent.setup();
    let catalogsState = { ...mockCatalogs };

    const api = vi.fn().mockImplementation((action: string, input: unknown) => {
      if (action === "get_master_catalogs") {
        return Promise.resolve(catalogsState);
      }
      if (action === "admin_manage_master_food") {
        const payload = input as { action: string; name: string; category: string; defaultQuantity: string };
        if (payload.action === "create") {
          const newItem = {
            id: "food-new",
            name: payload.name,
            description: null,
            category: payload.category as any,
            default_quantity: payload.defaultQuantity,
            is_critical: false,
            active: true,
            created_at: "2026-10-10T00:00:00Z",
            updated_at: "2026-10-10T00:00:00Z",
          };
          catalogsState = {
            ...catalogsState,
            food: [...catalogsState.food, newItem],
          };
          return Promise.resolve(newItem);
        }
      }
      return Promise.reject(new Error(`unhandled: ${action}`));
    });

    render(
      <MemoryRouter>
        <MasterCatalogPage api={api} />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText("Sleeping Bag")).toBeInTheDocument());

    // Switch to Food tab
    await user.click(screen.getByRole("tab", { name: /food & groceries/i }));
    await user.click(screen.getByRole("button", { name: /\+ add/i }));

    const modal = screen.getByRole("dialog", { name: /add master grocery item/i });
    expect(modal).toBeInTheDocument();

    await user.type(within(modal).getByLabelText(/item name/i), "Marshmallows");
    await user.selectOptions(within(modal).getByLabelText(/category/i), "campfire");

    await user.click(within(modal).getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith(
        "admin_manage_master_food",
        expect.objectContaining({
          action: "create",
          name: "Marshmallows",
          category: "campfire",
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByText("Marshmallows")).toBeInTheDocument();
    });
  });

  it("allows retiring and reactivating a gear item", async () => {
    const user = userEvent.setup();
    let catalogsState = { ...mockCatalogs };

    const api = vi.fn().mockImplementation((action: string, input: unknown) => {
      if (action === "get_master_catalogs") {
        return Promise.resolve(catalogsState);
      }
      if (action === "admin_manage_master_gear") {
        const payload = input as { action: string; id: string; active: boolean };
        if (payload.action === "update") {
          catalogsState = {
            ...catalogsState,
            gear: catalogsState.gear.map((g) => (g.id === payload.id ? { ...g, active: payload.active } : g)),
          };
          return Promise.resolve(catalogsState.gear.find((g) => g.id === payload.id));
        }
      }
      return Promise.reject(new Error(`unhandled: ${action}`));
    });

    render(
      <MemoryRouter>
        <MasterCatalogPage api={api} />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText("Sleeping Bag")).toBeInTheDocument());

    const card = screen.getByText("Sleeping Bag").closest(".event-card") as HTMLElement;
    const retireBtn = within(card).getByRole("button", { name: /retire/i });
    await user.click(retireBtn);

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith(
        "admin_manage_master_gear",
        expect.objectContaining({
          action: "update",
          id: "gear-1",
          active: false,
        })
      );
    });
  });

  it("handles responsibility safe deletion with historical duty log explanation", async () => {
    const user = userEvent.setup();
    let catalogsState = { ...mockCatalogs };

    const api = vi.fn().mockImplementation((action: string, input: unknown) => {
      if (action === "get_master_catalogs") {
        return Promise.resolve(catalogsState);
      }
      if (action === "admin_delete_master_responsibility") {
        const payload = input as { id: string };
        catalogsState = {
          ...catalogsState,
          responsibilities: catalogsState.responsibilities.filter((r) => r.id !== payload.id),
        };
        return Promise.resolve({ success: true, action: "deleted", id: payload.id });
      }
      return Promise.reject(new Error(`unhandled: ${action}`));
    });

    render(
      <MemoryRouter>
        <MasterCatalogPage api={api} />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText("Sleeping Bag")).toBeInTheDocument());

    // Switch to Responsibilities
    await user.click(screen.getByRole("tab", { name: /responsibilities/i }));
    expect(screen.getByText("Campfire Setup")).toBeInTheDocument();

    const card = screen.getByText("Campfire Setup").closest(".event-card") as HTMLElement;
    await user.click(within(card).getByRole("button", { name: /delete/i }));

    const modal = screen.getByRole("dialog", { name: /delete master template/i });
    expect(modal).toBeInTheDocument();
    expect(within(modal).getByText(/duty logs/i)).toBeInTheDocument();

    await user.click(within(modal).getByRole("button", { name: /confirm delete/i }));

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith(
        "admin_delete_master_responsibility",
        expect.objectContaining({
          id: "resp-1",
        })
      );
    });

    await waitFor(() => {
      expect(screen.queryByText("Campfire Setup")).not.toBeInTheDocument();
    });
  });
});
