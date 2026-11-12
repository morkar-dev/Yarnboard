import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import MaterialsChecklist from "./MaterialsChecklist";

const MATERIALS = [
  "# Yarn",
  "- [Worsted wool](https://example.com/yarn), 5 skeins",
  "> Any worsted-weight wool works.",
  "# Tools",
  "- 5mm circular needles",
  "- Stitch markers",
].join("\n");

const meta = {
  component: MaterialsChecklist,
  args: { patternId: 42, materials: MATERIALS },
} satisfies Meta<typeof MaterialsChecklist>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithHeadingsAndNotes: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole("checkbox")).toHaveLength(3);
    await expect(canvas.getByRole("link", { name: "Worsted wool" })).toHaveAttribute("href", "https://example.com/yarn");
    await expect(canvas.getByRole("heading", { name: "Tools" })).toBeInTheDocument();
  },
};

export const TickBoxesRememberedOnThisDevice: Story = {
  play: async ({ canvas, userEvent }) => {
    const needles = canvas.getByLabelText("5mm circular needles");
    await userEvent.click(needles);
    await expect(needles).toBeChecked();
    await expect(localStorage.length).toBeGreaterThan(0);
  },
};

export const HebrewDisplayText: Story = {
  args: {
    displayText: ["# חוטים", "- [צמר](https://example.com/yarn), 5 פקעות", "> כל צמר בעובי worsted מתאים.", "# כלים", "- מסרגות עגולות 5 מ\"מ", "- סמני עין"].join("\n"),
  },
  globals: { locale: "he" },
};
