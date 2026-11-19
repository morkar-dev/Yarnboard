import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import UnsubscribePage from "./UnsubscribePage";
import * as api from "../api/client";

function renderAt(url: string) {
  render(
    <MemoryRouter initialEntries={[url]}>
      <UnsubscribePage />
    </MemoryRouter>,
  );
}

describe("UnsubscribePage", () => {
  it("unsubscribes with the token from the link", async () => {
    const unsubscribe = vi.spyOn(api, "unsubscribeFromNewsletter").mockResolvedValue({ unsubscribed: true });

    renderAt("/unsubscribe?token=abc");

    expect(await screen.findByText(/You're unsubscribed/)).toBeInTheDocument();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledWith("abc");
  });

  it("points to settings when the link has no token", () => {
    renderAt("/unsubscribe");

    expect(screen.getByText(/This link is incomplete/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Notification settings" })).toHaveAttribute("href", "/settings/notifications");
  });
});
