import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import NavSearch from "./NavSearch";

/** NavSearch lives inside the dark navbar -- render it on the same
 * background so contrast checks see what users see. */
const meta = {
  component: NavSearch,
  decorators: [
    (Story) => (
      <div className="navbar-eggplant p-2 d-flex justify-content-end" data-bs-theme="dark">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof NavSearch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {};

export const OpensAndSearches: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Open search" }));
    const input = canvas.getByRole("searchbox", { name: "Search patterns..." });
    await expect(input).toHaveFocus();
    await userEvent.type(input, "beanie");
    await userEvent.click(canvas.getByRole("button", { name: "Search" }));
    // Submitting navigates to /community?q=... and closes the box.
    await expect(canvas.queryByRole("searchbox")).not.toBeInTheDocument();
  },
};

export const EscapeCloses: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Open search" }));
    await userEvent.keyboard("{Escape}");
    await expect(canvas.queryByRole("searchbox")).not.toBeInTheDocument();
  },
};

export const PrefilledOnCommunityPage: Story = {
  parameters: { route: "/community?q=scarf" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Open search" }));
    await expect(canvas.getByRole("searchbox")).toHaveValue("scarf");
  },
};
