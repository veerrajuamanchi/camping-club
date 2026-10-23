import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { MealPreferencesModal } from "../MealPreferencesModal";
import { EventDetailsPage } from "../EventDetailsPage";
import { TripTasksAndMealsTab } from "../TripTasksAndMealsTab";

describe("Task 4: Meal & Beverage Preferences and Cook Headcounts", () => {
  describe("MealPreferencesModal", () => {
    const mockMealSlots = [
      { id: "slot-fri-dinner", label: "Friday Dinner", date: "2026-12-05" },
      { id: "slot-sat-breakfast", label: "Saturday Breakfast", date: "2026-12-06" },
      { id: "slot-sat-lunch", label: "Saturday Lunch", date: "2026-12-06" },
      { id: "slot-sat-dinner", label: "Saturday Dinner", date: "2026-12-06" },
      { id: "slot-sun-breakfast", label: "Sunday Breakfast", date: "2026-12-07" },
    ];

    it("renders modal with beverages, quick actions, meal slots, and notes", () => {
      render(
        <MealPreferencesModal
          isOpen={true}
          onClose={vi.fn()}
          tripId="trip-1"
          mealSlots={mockMealSlots}
          initialPreferences={null}
          onSave={vi.fn()}
        />
      );

      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.getByText(/Edit Meal & Beverage Preferences/i)).toBeInTheDocument();
      expect(screen.getByText(/Saturday Morning/i)).toBeInTheDocument();
      expect(screen.getByText(/Sunday Morning/i)).toBeInTheDocument();

      // Quick action buttons
      expect(screen.getByRole("button", { name: /Set All: 🥗 Vegetarian/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Set All: 🍖 Non-Vegetarian/i })).toBeInTheDocument();

      // Meal slot labels
      expect(screen.getByText("Friday Dinner")).toBeInTheDocument();
      expect(screen.getByText("Saturday Breakfast")).toBeInTheDocument();
      expect(screen.getByText("Saturday Lunch")).toBeInTheDocument();
      expect(screen.getByText("Saturday Dinner")).toBeInTheDocument();
      expect(screen.getByText("Sunday Breakfast")).toBeInTheDocument();

      // Notes input
      expect(screen.getByPlaceholderText(/Peanut allergy, gluten-free/i)).toBeInTheDocument();
    });

    it("allows selecting Saturday Coffee, Sunday Tea, toggling Skip for a meal, and saving", async () => {
      const user = userEvent.setup();
      const onSave = vi.fn().mockResolvedValue(undefined);
      const onClose = vi.fn();

      render(
        <MealPreferencesModal
          isOpen={true}
          onClose={onClose}
          tripId="trip-1"
          mealSlots={mockMealSlots}
          initialPreferences={{
            saturdayBeverage: "coffee",
            sundayBeverage: "tea",
            defaultDiet: "vegetarian",
            mealChoices: {},
            allergiesNotes: "",
          }}
          onSave={onSave}
        />
      );

      // Select Saturday Tea
      const satTeaRadio = screen.getByLabelText(/Hot Chai \/ Tea/i, { selector: 'input[name="sat_beverage"]' });
      await user.click(satTeaRadio);

      // Select Sunday Coffee
      const sunCoffeeRadio = screen.getByLabelText(/Fresh Brewed Coffee/i, { selector: 'input[name="sun_beverage"]' });
      await user.click(sunCoffeeRadio);

      // In Saturday Lunch row, click Skip pill
      const satLunchRow = screen.getByText("Saturday Lunch").closest(".meal-slot-row")!;
      const skipBtn = within(satLunchRow as HTMLElement).getByRole("button", { name: /Skip/i });
      await user.click(skipBtn);

      // Enter notes
      const notesInput = screen.getByPlaceholderText(/Peanut allergy, gluten-free/i);
      await user.type(notesInput, "Tree nut allergy");

      // Save
      const saveBtn = screen.getByRole("button", { name: /Save Preferences/i });
      await user.click(saveBtn);

      expect(onSave).toHaveBeenCalledTimes(1);
      const savedPayload = onSave.mock.calls[0][0];
      expect(savedPayload.saturdayBeverage).toBe("tea");
      expect(savedPayload.sundayBeverage).toBe("coffee");
      expect(savedPayload.mealChoices["slot-sat-lunch"]).toBe("skip");
      expect(savedPayload.allergiesNotes).toBe("Tree nut allergy");
    });
  });

  describe("EventDetailsPage Integration", () => {
    const mockDetails = {
      tripId: "trip-meals-1",
      monthKey: "2026-12",
      title: "Big Basin Redwood Retreat",
      eventStatus: "confirmed" as const,
      tripStatus: "confirmed" as const,
      pollStatus: "closed" as const,
      startsOn: "2026-12-05",
      endsOn: "2026-12-07",
      minimumParticipants: 4,
      depositAmountCents: 5000,
      cabinPayerMemberId: "m-payer",
      depositStatus: "exempt" as const,
      comingCount: 4,
      spotsRemaining: 2,
      waitlistCount: 0,
      myWaitlistPosition: null,
      myDutyCount: 2,
      taskQuotaTarget: 2,
      myDailyWorkload: null,
      myRsvp: {
        response: "coming" as const,
        version: 1,
        acknowledgmentId: "ack-1",
        updatedAt: "2026-10-01T00:00:00Z",
      },
      currentRuleBundle: {
        id: "bundle-1",
        version: 1,
        contentHash: "hash123",
        rules: [],
        createdAt: "2026-10-01T00:00:00Z",
      },
      participantEntries: [
        { memberId: "m-user", displayName: "Test Camper", response: "coming", depositStatus: "exempt" },
      ],
      waitlistEntries: [],
      version: 1,
      myMealPreferences: {
        saturdayBeverage: "coffee" as const,
        sundayBeverage: "tea" as const,
        defaultDiet: "vegetarian" as const,
        mealChoices: {},
        allergiesNotes: null,
      },
      mealHeadcounts: {
        beverages: {
          saturday: { coffee: 3, tea: 1, none: 0 },
          sunday: { coffee: 2, tea: 2, none: 0 },
        },
        meals: [
          {
            slotId: "slot-fri-dinner",
            slotLabel: "Friday Dinner",
            slotDate: "2026-12-05",
            vegCount: 3,
            nonVegCount: 1,
            skipCount: 0,
            totalEating: 4,
          },
          {
            slotId: "slot-sat-lunch",
            slotLabel: "Saturday Lunch",
            slotDate: "2026-12-06",
            vegCount: 2,
            nonVegCount: 1,
            skipCount: 1,
            totalEating: 3,
          },
        ],
      },
    };

    it("renders '☕🍽️ Meals & Drinks' row in 'Required From You' with summary badge and Edit Choices button", async () => {
      const apiMock = vi.fn().mockImplementation((action: string) => {
        if (action === "get_trip_details") return Promise.resolve(mockDetails);
        if (action === "get_constitution") return Promise.resolve({ definitions: [] });
        return Promise.resolve({});
      });

      render(
        <MemoryRouter initialEntries={["/trips/trip-meals-1"]}>
          <Routes>
            <Route
              path="/trips/:tripId"
              element={<EventDetailsPage isAdmin={false} currentMemberId="m-user" api={apiMock} />}
            />
          </Routes>
        </MemoryRouter>
      );

      const mealsRow = await screen.findByTestId("hub-meals-row");
      expect(mealsRow).toBeInTheDocument();
      expect(within(mealsRow).getByText(/Meals & Drinks/i)).toBeInTheDocument();
      expect(within(mealsRow).getByText(/Sat: Coffee, Sun: Tea/i)).toBeInTheDocument();
      expect(within(mealsRow).getByRole("button", { name: /Edit Choices/i })).toBeInTheDocument();
    });

    it("clicking 'Edit Choices' opens the modal and saving calls save_meal_preferences", async () => {
      const user = userEvent.setup();
      const apiMock = vi.fn().mockImplementation((action: string) => {
        if (action === "get_trip_details") return Promise.resolve(mockDetails);
        if (action === "get_constitution") return Promise.resolve({ definitions: [] });
        if (action === "save_meal_preferences") return Promise.resolve({ success: true });
        return Promise.resolve({});
      });

      render(
        <MemoryRouter initialEntries={["/trips/trip-meals-1"]}>
          <Routes>
            <Route
              path="/trips/:tripId"
              element={<EventDetailsPage isAdmin={false} currentMemberId="m-user" api={apiMock} />}
            />
          </Routes>
        </MemoryRouter>
      );

      const mealsRow = await screen.findByTestId("hub-meals-row");
      const editBtn = within(mealsRow).getByRole("button", { name: /Edit Choices/i });
      await user.click(editBtn);

      expect(await screen.findByRole("dialog")).toBeInTheDocument();

      // Click "Set All: 🍖 Non-Vegetarian"
      const setAllNonVeg = screen.getByRole("button", { name: /Set All: 🍖 Non-Vegetarian/i });
      await user.click(setAllNonVeg);

      // Save
      const saveBtn = screen.getByRole("button", { name: /Save Preferences/i });
      await user.click(saveBtn);

      expect(apiMock).toHaveBeenCalledWith("save_meal_preferences", expect.objectContaining({
        tripId: "trip-meals-1",
        defaultDiet: "non_vegetarian",
      }));
    });
  });

  describe("TripTasksAndMealsTab Cook Headcounts", () => {
    it("renders Cook Headcounts card with beverage totals and meal portions table", async () => {
      const mockTasksApi = vi.fn().mockImplementation((action: string) => {
        if (action === "get_trip_task_matrix") {
          return Promise.resolve({
            timeSlots: [],
            activeAssignments: [],
            driverCredits: [],
            myQuotaProgress: null,
            confirmedAttendees: [{ memberId: "m-user", displayName: "Test Camper" }],
            mealHeadcounts: {
              beverages: {
                saturday: { coffee: 5, tea: 3, none: 1 },
                sunday: { coffee: 4, tea: 4, none: 1 },
              },
              meals: [
                {
                  slotId: "slot-fri-dinner",
                  slotLabel: "Friday Welcome Dinner",
                  slotDate: "2026-12-05",
                  vegCount: 6,
                  nonVegCount: 2,
                  skipCount: 1,
                  totalEating: 8,
                },
                {
                  slotId: "slot-sat-breakfast",
                  slotLabel: "Saturday Big Breakfast",
                  slotDate: "2026-12-06",
                  vegCount: 5,
                  nonVegCount: 4,
                  skipCount: 0,
                  totalEating: 9,
                },
              ],
            },
          });
        }
        return Promise.resolve({});
      });

      render(
        <TripTasksAndMealsTab
          tripId="trip-meals-1"
          isConfirmedAttendee={true}
          isAdmin={false}
          currentMemberId="m-user"
          api={mockTasksApi}
        />
      );

      const cookCard = await screen.findByTestId("cook-headcounts-card");
      expect(cookCard).toBeInTheDocument();
      expect(within(cookCard).getByText(/Cook & Kitchen Headcounts/i)).toBeInTheDocument();

      // Beverage section
      expect(within(cookCard).getByText(/Saturday Morning:/i)).toBeInTheDocument();
      expect(within(cookCard).getByText(/Sunday Morning:/i)).toBeInTheDocument();
      expect(within(cookCard).getAllByText(/☕ Coffee:/i)).toHaveLength(2);
      expect(within(cookCard).getAllByText(/🍵 Tea:/i)).toHaveLength(2);

      // Meals table
      const mealsTable = screen.getByTestId("cook-meals-table");
      expect(mealsTable).toBeInTheDocument();
      expect(within(mealsTable).getByText("Friday Welcome Dinner")).toBeInTheDocument();
      expect(within(mealsTable).getByText("Saturday Big Breakfast")).toBeInTheDocument();
      const rows = within(mealsTable).getAllByRole("row");
      expect(rows).toHaveLength(3);
      expect(within(rows[1]).getByText("6")).toBeInTheDocument(); // Fri Veg
      expect(within(rows[1]).getByText("8")).toBeInTheDocument(); // Fri Total Eating
    });
  });
});
