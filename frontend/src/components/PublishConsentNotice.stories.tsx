import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn } from "storybook/test";
import PublishConsentNotice from "./PublishConsentNotice";

const meta = {
  component: PublishConsentNotice,
  args: { acknowledged: false, onAcknowledgeChange: fn() },
} satisfies Meta<typeof PublishConsentNotice>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NotAcknowledged: Story = {
  play: async ({ canvas, userEvent, args }) => {
    await userEvent.click(canvas.getByLabelText("I understand this pattern will be published publicly."));
    await expect(args.onAcknowledgeChange).toHaveBeenCalledWith(true);
  },
};

export const Acknowledged: Story = { args: { acknowledged: true } };
