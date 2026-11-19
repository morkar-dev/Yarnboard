import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AdminNewsletterPage from "./AdminNewsletterPage";
import * as api from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { User } from "../types/models";

vi.mock("../context/AuthContext", () => ({ useAuth: vi.fn() }));

function mockUser(is_admin: boolean) {
  const user: User = { id: 1, username: "admin", email: "admin@example.com", is_admin };
  vi.mocked(useAuth).mockReturnValue({ user, loading: false, login: vi.fn(), register: vi.fn(), logout: vi.fn() });
}

async function writeDraft(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText("Subject"), "Photos are back");
  await user.type(screen.getByLabelText("Message"), "Upload a photo of any pattern.");
}

beforeEach(() => {
  vi.restoreAllMocks();
  mockUser(true);
});

describe("AdminNewsletterPage", () => {
  it("is only for admins", () => {
    mockUser(false);
    render(<AdminNewsletterPage />);
    expect(screen.getByText("Only admins can send newsletters.")).toBeInTheDocument();
  });

  it("sends only after confirming the subject and the number of subscribers", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "fetchNewsletterStatus").mockResolvedValue({ subscriber_count: 3 });
    const send = vi.spyOn(api, "sendNewsletter").mockResolvedValue({ sent: 3 });
    render(<AdminNewsletterPage />);
    await writeDraft(user);

    await user.click(screen.getByRole("button", { name: "Send to subscribers" }));
    expect(send).not.toHaveBeenCalled();
    expect(screen.getByText(/Send “Photos are back” to 3 subscribers\?/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Yes, send it" }));

    expect(send).toHaveBeenCalledWith({ subject: "Photos are back", body: "Upload a photo of any pattern." }, 3);
    expect(await screen.findByText("Sent to 3 subscribers.")).toBeInTheDocument();
    expect(screen.getByLabelText("Subject")).toHaveValue("");
  });

  it("shows the new number when subscribers changed before sending", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "fetchNewsletterStatus").mockResolvedValue({ subscriber_count: 3 });
    vi.spyOn(api, "sendNewsletter").mockRejectedValue(
      new api.ApiError(409, "changed", "subscriber_count_changed", { subscriber_count: 4 }),
    );
    render(<AdminNewsletterPage />);
    await writeDraft(user);

    await user.click(screen.getByRole("button", { name: "Send to subscribers" }));
    await user.click(screen.getByRole("button", { name: "Yes, send it" }));

    expect(await screen.findByText(/changed to 4/)).toBeInTheDocument();
    expect(screen.getByText("4 subscribers")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Yes, send it" })).toBeNull();
  });

  it("can't send when nobody has subscribed", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "fetchNewsletterStatus").mockResolvedValue({ subscriber_count: 0 });
    render(<AdminNewsletterPage />);
    await writeDraft(user);

    await waitFor(() => expect(screen.getByRole("button", { name: "Send to subscribers" })).toBeDisabled());
  });
});
