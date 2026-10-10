import { fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { AdminConstitutionPage } from "./AdminConstitutionPage";
import { makeCalendar } from "../trips/TripCalendarPage.test";
import type { ReactElement } from "react";

const render = (ui: ReactElement) => rtlRender(ui, { wrapper: MemoryRouter });

describe("AdminConstitutionPage", () => {
  it("shows the seeded general rule text in rule history", async () => {
    const calendar = makeCalendar();
    const generalRules = [
      { id: "driver", stable_key: "driver-mileage", category: "transport", scope: "general", active: true },
      { id: "meals", stable_key: "meal-preferences", category: "meals", scope: "general", active: true },
    ];
    const versions = [
      { id: "driver-v1", definition_id: "driver", version_no: 1, human_text: "A driver is reimbursed $0.76 per mile when the carpool carries at least three people, including the driver.", effective_from: "2026-01-01T00:00:00Z", expires_at: null },
      { id: "meals-v1", definition_id: "meals", version_no: 1, human_text: "Collect vegetarian or non-vegetarian preferences for the whole trip or each planned meal.", effective_from: "2026-01-01T00:00:00Z", expires_at: null },
    ];
    const api = vi.fn(async (action: string) =>
      action === "get_constitution"
        ? { definitions: generalRules, versions, overrides: [] }
        : calendar
    );

    render(<AdminConstitutionPage api={api as any} />);

    expect(await screen.findByText(versions[0].human_text)).toBeInTheDocument();
    expect(screen.getByText(versions[1].human_text)).toBeInTheDocument();
  });

  it("lets an administrator publish an expiring override linked to a current general rule version", async () => {
    const calendar = makeCalendar();
    const constitution = {
      definitions: [{ id: "def-1", stable_key: "quiet-hours", category: "conduct", scope: "general", active: true }],
      versions: [{ id: "version-1", definition_id: "def-1", version_no: 2, human_text: "Use quiet hours.", effective_from: "2026-01-01T00:00:00Z", expires_at: null }],
      overrides: [],
      currentBundle: null,
      myAcknowledgments: [],
    };
    const api = vi.fn(async (action: string) =>
      action === "get_calendar" ? calendar : constitution
    );

    render(<AdminConstitutionPage api={api as any} />);

    fireEvent.change(await screen.findByLabelText("Applies to"), { target: { value: "trip" } });
    expect(await screen.findByText("Override a general rule for this trip")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("General rule to override"), { target: { value: "version-1" } });
    fireEvent.change(screen.getByLabelText("Trip-specific text"), { target: { value: "Use quiet hours as agreed by this trip." } });
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 16);
    fireEvent.change(screen.getByLabelText("Override expires at"), { target: { value: tomorrow } });
    fireEvent.change(screen.getByLabelText("Reason", { selector: "input" }), { target: { value: "Trip-specific agreement" } });

    fireEvent.click(screen.getByRole("button", { name: "Publish expiring override" }));

    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        "admin_set_rule_override",
        expect.objectContaining({
          tripId: "trip-1",
          baseRuleVersionId: "version-1",
          text: "Use quiet hours as agreed by this trip.",
        })
      )
    );
  });
});
