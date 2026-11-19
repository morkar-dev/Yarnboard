import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import NavSearch from "./NavSearch";

function renderSearch() {
  render(
    <MemoryRouter>
      <NavSearch />
      <button type="button">Elsewhere</button>
    </MemoryRouter>,
  );
}

describe("NavSearch", () => {
  it("stays open when Tab moves from the box to its submit button", async () => {
    const user = userEvent.setup();
    renderSearch();

    await user.click(screen.getByRole("button", { name: "Open search" }));
    expect(screen.getByRole("searchbox")).toHaveFocus();

    await user.tab();

    expect(screen.getByRole("searchbox")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Search" })).toHaveFocus();
  });

  it("collapses when focus leaves the whole search form", async () => {
    const user = userEvent.setup();
    renderSearch();

    await user.click(screen.getByRole("button", { name: "Open search" }));
    await user.click(screen.getByRole("button", { name: "Elsewhere" }));

    expect(screen.queryByRole("searchbox")).toBeNull();
  });
});
