import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn } from "storybook/test";
import { t } from "../mocks/text";
import PublishConsentNotice from "./PublishConsentNotice";

const meta = {
  component: PublishConsentNotice,
  args: { acknowledged: false, onAcknowledgeChange: fn() },
} satisfies Meta<typeof PublishConsentNotice>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NotAcknowledged: Story = {
  play: async ({ canvas, userEvent, args }) => {
    await userEvent.click(canvas.getByLabelText(t("publishConsent.checkboxLabel")));
    await expect(args.onAcknowledgeChange).toHaveBeenCalledWith(true);
  },
};

export const Acknowledged: Story = { args: { acknowledged: true } };
