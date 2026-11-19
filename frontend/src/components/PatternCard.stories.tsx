import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn } from "storybook/test";
import { t } from "../mocks/text";
import * as fixtures from "../mocks/fixtures";
import PatternCard from "./PatternCard";

const meta = {
  component: PatternCard,
  decorators: [(Story) => <div style={{ maxWidth: 320 }}><Story /></div>],
  args: { pattern: fixtures.publicPattern },
} satisfies Meta<typeof PatternCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Public: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("link", { name: "Simple Garter Scarf" })).toHaveAttribute("href", "/pattern/43");
    await expect(canvas.queryByText(t("patternCard.private"))).not.toBeInTheDocument();
  },
};

export const Private: Story = {
  args: { pattern: fixtures.pattern },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(t("patternCard.private"))).toBeInTheDocument();
  },
};

export const LongTitle: Story = {
  args: {
    pattern: {
      ...fixtures.publicPattern,
      title: "An Extremely Long Pattern Title That Keeps Going Well Past What Fits On One Line Of A Card",
    },
  },
};

export const HebrewTitle: Story = {
  args: {
    pattern: {
      ...fixtures.publicPattern,
      translations: {
        en: null,
        he: { title: "צעיף פשוט", materials: null, abbreviations: null, instructions: {}, reviewed: true },
      },
    },
  },
  globals: { locale: "he" },
};

export const SaveToggle: Story = {
  args: { onToggleSave: fn(), isSaved: false },
  play: async ({ canvas, userEvent, args }) => {
    await userEvent.click(canvas.getByRole("button", { name: t("patternCard.save") }));
    await expect(args.onToggleSave).toHaveBeenCalledWith(fixtures.publicPattern);
  },
};

export const Saved: Story = {
  args: { onToggleSave: fn(), isSaved: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("button", { name: t("patternCard.removeSaved") })).toBeInTheDocument();
  },
};
