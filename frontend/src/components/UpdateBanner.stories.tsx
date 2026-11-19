import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor } from "storybook/test";
import * as fixtures from "../mocks/fixtures";
import { loggedIn, updateNoticesWith } from "../mocks/handlers";
import UpdateBanner from "./UpdateBanner";

const meta = {
  component: UpdateBanner,
  parameters: { msw: { handlers: { auth: loggedIn, updates: updateNoticesWith(fixtures.updateNotices) } } },
} satisfies Meta<typeof UpdateBanner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PatternChanged: Story = {
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("link", { name: "Cozy Raglan Sweater" })).toHaveAttribute("href", "/pattern/42");
  },
};

export const Dismiss: Story = {
  play: async ({ canvas, userEvent }) => {
    await canvas.findByRole("link", { name: "Cozy Raglan Sweater" });
    await userEvent.click(canvas.getByRole("button", { name: /close/i }));
    await waitFor(() => expect(canvas.queryByRole("alert")).not.toBeInTheDocument());
  },
};

export const NothingChanged: Story = {
  parameters: { msw: { handlers: { updates: updateNoticesWith([]) } } },
};
