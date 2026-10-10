import { fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { AdminScheduleDefaultsPage } from "./AdminScheduleDefaultsPage";
import { makeCalendar } from "../trips/TripCalendarPage.test";
import type { ReactElement } from "react";

const render = (ui: ReactElement) => rtlRender(ui, { wrapper: MemoryRouter });

describe("AdminScheduleDefaultsPage", () => {
  it("shows schedule controls and saves the selected timezone and lead days", async () => {
    const calendar = makeCalendar();
    const api = vi.fn(async () => calendar);
    render(<AdminScheduleDefaultsPage api={api as any} />);

    expect(await screen.findByText("Club Schedule Defaults")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Club timezone/), { target: { value: "America/Denver" } });
    fireEvent.click(screen.getByRole("button", { name: "Save schedule defaults" }));

    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        "admin_configure_club",
        expect.objectContaining({
          timezone: "America/Denver",
          defaultMinimumParticipants: 4,
          expectedVersion: 2,
        })
      )
    );
  });

  it("replenishes the 12-month calendar horizon", async () => {
    const calendar = makeCalendar();
    const api = vi.fn(async () => calendar);
    render(<AdminScheduleDefaultsPage api={api as any} />);

    expect(await screen.findByText("Calendar Horizon")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Replenish calendar through 12 months ahead" }));

    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        "admin_generate_calendar",
        expect.objectContaining({
          throughMonth: expect.any(String),
        })
      )
    );
  });
});
