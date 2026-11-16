import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor } from "storybook/test";
import { t, tExact, tMatch } from "../mocks/text";
import * as fixtures from "../mocks/fixtures";
import { inboxWith, loggedIn, loggedOut } from "../mocks/handlers";
import NotificationBell from "./NotificationBell";

const meta = {
  component: NotificationBell,
  decorators: [
    (Story) => (
      <div className="navbar-eggplant p-3 d-flex justify-content-end" data-bs-theme="dark" style={{ minHeight: 320 }}>
        <Story />
      </div>
    ),
  ],
  parameters: { msw: { handlers: { auth: loggedIn, inbox: inboxWith(fixtures.inbox) } } },
} satisfies Meta<typeof NotificationBell>;

export default meta;
type Story = StoryObj<typeof meta>;

export const UnreadBadge: Story = {
  play: async ({ canvas }) => {
    const bell = await canvas.findByRole("button", { name: tMatch("notifications.bellLabel") });
    await waitFor(() => expect(bell).toHaveTextContent("1"));
  },
};

export const OpenInboxAndMarkAllRead: Story = {
  play: async ({ canvas, userEvent }) => {
    const bell = await canvas.findByRole("button", { name: tMatch("notifications.bellLabel") });
    await waitFor(() => expect(bell).toHaveTextContent("1"));
    await userEvent.click(bell);
    await expect(await canvas.findByText(/shared “Simple Garter Scarf”/)).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: t("notifications.markAllRead") }));
    await waitFor(() => expect(bell).toHaveTextContent(tExact("notifications.bellLabel")));
  },
};

export const EmptyInbox: Story = {
  parameters: { msw: { handlers: { inbox: inboxWith([]) } } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: tMatch("notifications.bellLabel") }));
    await expect(await canvas.findByText(t("notifications.empty"))).toBeVisible();
  },
};

/** Logged-out visitors get no bell at all. */
export const Guest: Story = {
  parameters: { msw: { handlers: { auth: loggedOut } } },
};
