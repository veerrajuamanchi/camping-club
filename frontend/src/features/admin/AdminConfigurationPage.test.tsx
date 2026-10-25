import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { AdminConfigurationPage } from "./AdminConfigurationPage";

describe("AdminConfigurationPage", () => {
  it("renders all 6 administrative configuration sections with direct links", () => {
    render(
      <MemoryRouter>
        <AdminConfigurationPage />
      </MemoryRouter>
    );

    expect(screen.getByRole("heading", { name: /Club Master Configuration/i })).toBeInTheDocument();
    expect(screen.getByText(/Camping Constitution/i)).toBeInTheDocument();
    expect(screen.getByText(/Campsite Directory/i)).toBeInTheDocument();
    expect(screen.getByText(/Master Responsibilities/i)).toBeInTheDocument();
    expect(screen.getByText(/Master Catalogs & Activities/i)).toBeInTheDocument();
    expect(screen.getByText(/Club Schedule Defaults/i)).toBeInTheDocument();
    expect(screen.getByText(/Members & Access/i)).toBeInTheDocument();

    const links = screen.getAllByRole("link");
    expect(links.some((l) => l.getAttribute("href") === "/admin/constitution")).toBe(true);
    expect(links.some((l) => l.getAttribute("href") === "/admin/campsites")).toBe(true);
    expect(links.some((l) => l.getAttribute("href") === "/admin/responsibilities")).toBe(true);
    expect(links.some((l) => l.getAttribute("href") === "/admin/catalogs")).toBe(true);
    expect(links.some((l) => l.getAttribute("href") === "/admin/schedule-defaults")).toBe(true);
    expect(links.some((l) => l.getAttribute("href") === "/admin/members")).toBe(true);
  });
});
