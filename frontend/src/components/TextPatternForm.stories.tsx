import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, waitFor } from "storybook/test";
import { t } from "../mocks/text";
import * as fixtures from "../mocks/fixtures";
import { previewFails, previewPending } from "../mocks/handlers";
import TextPatternForm from "./TextPatternForm";

const PASTED = "Cozy Beanie\nMaterials:\n- 2 skeins of yarn\nInstructions:\n1. Cast on 96 stitches.";

const meta = {
  component: TextPatternForm,
  args: { onResult: fn() },
} satisfies Meta<typeof TextPatternForm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("button", { name: t("submit.textButton") })).toBeDisabled();
  },
};

export const SubmitsAndReturnsDraft: Story = {
  play: async ({ canvas, userEvent, args }) => {
    await userEvent.type(canvas.getByLabelText(t("submit.textLabel")), PASTED);
    await userEvent.type(canvas.getByLabelText(t("submit.sourceUrlLabel")), "https://example.com/beanie");
    await userEvent.click(canvas.getByRole("button", { name: t("submit.textButton") }));
    await waitFor(() =>
      expect(args.onResult).toHaveBeenCalledWith(
        expect.objectContaining({ draft: fixtures.draft }),
        "https://example.com/beanie",
      ),
    );
  },
};

export const ServerCantReadIt: Story = {
  parameters: { msw: { handlers: { preview: previewFails } } },
  play: async ({ canvas, userEvent, args }) => {
    await userEvent.type(canvas.getByLabelText(t("submit.textLabel")), "just some words");
    await userEvent.click(canvas.getByRole("button", { name: t("submit.textButton") }));
    await expect(await canvas.findByRole("alert")).toBeVisible();
    await expect(args.onResult).not.toHaveBeenCalled();
  },
};

export const Processing: Story = {
  parameters: { msw: { handlers: { preview: previewPending } } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByLabelText(t("submit.textLabel")), PASTED);
    await userEvent.click(canvas.getByRole("button", { name: t("submit.textButton") }));
    await expect(await canvas.findByRole("button", { name: t("submit.processing") })).toBeDisabled();
  },
};
