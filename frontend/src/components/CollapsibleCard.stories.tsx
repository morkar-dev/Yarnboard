import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor } from "storybook/test";
import CollapsibleCard from "./CollapsibleCard";

const meta = {
  component: CollapsibleCard,
  args: {
    title: "Materials",
    children: <p className="mb-0">5 skeins of worsted wool, 5mm circular needles.</p>,
  },
} satisfies Meta<typeof CollapsibleCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Expanded: Story = {};

export const Collapsed: Story = { args: { defaultExpanded: false } };

export const ToggleOpenAndClosed: Story = {
  play: async ({ canvas, userEvent }) => {
    const header = canvas.getByRole("button", { name: /Materials/ });
    await expect(header).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(header);
    await expect(header).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => expect(canvas.getByText(/5 skeins/)).not.toBeVisible());
    await userEvent.click(header);
    await waitFor(() => expect(canvas.getByText(/5 skeins/)).toBeVisible());
  },
};
