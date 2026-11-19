import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NotificationSettingsPage from "./NotificationSettingsPage";
import * as api from "../api/client";

const settings = {
  pattern_updated: { email: true, in_app: true },
  pattern_shared: { email: true, in_app: true },
};

describe("NotificationSettingsPage", () => {
  it("shows product updates off until the user turns them on", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "fetchNotificationSettings").mockResolvedValue(settings);
    vi.spyOn(api, "fetchNewsletterSubscription").mockResolvedValue({ subscribed: false });
    const update = vi.spyOn(api, "updateNewsletterSubscription").mockResolvedValue({ subscribed: true });
    render(<NotificationSettingsPage />);

    expect(await screen.findByText("Product updates")).toBeInTheDocument();
    const toggle = document.getElementById("newsletter-email") as HTMLInputElement;
    expect(toggle).not.toBeChecked();

    await user.click(toggle);

    expect(update).toHaveBeenCalledWith(true);
    await waitFor(() => expect(toggle).toBeChecked());
  });
});
