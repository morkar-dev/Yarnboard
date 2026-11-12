import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor } from "storybook/test";
import { loggedIn, loggedOut, progressFails } from "../mocks/handlers";
import type { InstructionsMap } from "../types/models";
import PatternChecklist from "./PatternChecklist";

const instructions: InstructionsMap = {
  Body: [
    { step: "# Ribbing", completed: false },
    { step: "Cast on 120 stitches.", completed: true },
    { step: "> Use the smaller needles for the rib.", completed: false },
    { step: "1-6 Knit 2, purl 2 around.", completed: false },
    { step: "Knit every round until the body measures 35 cm.", completed: false },
  ],
  Sleeves: [
    { step: "Cast on 40 stitches.", completed: false },
    { step: "Knit 2x2 rib for 5 cm.", completed: false },
  ],
};

const meta = {
  component: PatternChecklist,
  args: { patternId: 42, instructions },
  parameters: { msw: { handlers: { auth: loggedIn } } },
  // window.confirm is used by "Clear all checks"; auto-accept it in tests.
  beforeEach: () => {
    const original = window.confirm;
    window.confirm = () => true;
    return () => {
      window.confirm = original;
    };
  },
} satisfies Meta<typeof PatternChecklist>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The checklist mounts before the fake session check answers (as a
 * guest), then switches to logged-in -- wait for that before clicking, or
 * the click takes the guest (localStorage) path instead of the API. */
const sessionLoaded = (canvas: { queryByText: (t: RegExp) => HTMLElement | null }) =>
  waitFor(() => expect(canvas.queryByText(/checking items off as a guest/)).not.toBeInTheDocument());

export const LoggedIn: Story = {
  play: async ({ canvas, userEvent }) => {
    await sessionLoaded(canvas);
    const step = canvas.getByLabelText("Knit every round until the body measures 35 cm.");
    await userEvent.click(step);
    await expect(step).toBeChecked();
  },
};

export const SaveFailsAndReverts: Story = {
  parameters: { msw: { handlers: { progress: progressFails } } },
  play: async ({ canvas, userEvent }) => {
    await sessionLoaded(canvas);
    const step = canvas.getByLabelText("Cast on 40 stitches.");
    await userEvent.click(step);
    await waitFor(() => expect(step).not.toBeChecked());
  },
};

export const Guest: Story = {
  parameters: { msw: { handlers: { auth: loggedOut } } },
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByText(/checking items off as a guest/)).toBeInTheDocument();
    await userEvent.click(canvas.getByLabelText("Cast on 40 stitches."));
    await expect(JSON.parse(localStorage.getItem("yarnboard:guest-progress:42")!)).toEqual({
      Sleeves: [true],
    });
  },
};

export const RowCounter: Story = {
  play: async ({ canvas, userEvent }) => {
    const more = canvas.getByRole("button", { name: "One row done" });
    await userEvent.click(more);
    await userEvent.click(more);
    await expect(canvas.getByText("2 / 6 rows (next: row 3)")).toBeInTheDocument();
    for (let i = 0; i < 4; i++) await userEvent.click(more);
    await expect(canvas.getByText("All 6 rows done")).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "One row back" }));
    await expect(canvas.getByText("5 / 6 rows (next: row 6)")).toBeInTheDocument();
  },
};

export const CollapseAndClearAll: Story = {
  play: async ({ canvas, userEvent }) => {
    await sessionLoaded(canvas);
    await userEvent.click(canvas.getByRole("button", { name: "Collapse all" }));
    await expect(canvas.getByRole("button", { name: "Expand all" })).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Expand all" }));

    await userEvent.click(canvas.getByRole("button", { name: "Clear all checks" }));
    await waitFor(() => expect(canvas.getByLabelText("Cast on 120 stitches.")).not.toBeChecked());
    await expect(canvas.getByRole("button", { name: "Clear all checks" })).toBeDisabled();
  },
};

export const NoInstructions: Story = { args: { instructions: {} } };

export const HebrewOverlay: Story = {
  globals: { locale: "he" },
  args: {
    instructionsHe: {
      Body: {
        heading_he: "גוף",
        steps_he: ["# גומי", "העלו 120 עיניים.", "> השתמשו במסרגות הקטנות לגומי.", "1-6 2 ימין, 2 שמאל.", "סרגו ימין עד שהגוף באורך 35 ס\"מ."],
      },
      Sleeves: { heading_he: "שרוולים", steps_he: ["העלו 40 עיניים.", "סרגו גומי 2x2 לאורך 5 ס\"מ."] },
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("גוף")).toBeInTheDocument();
    await expect(document.documentElement).toHaveAttribute("dir", "rtl");
  },
};

export const Mobile: Story = {
  globals: { viewport: { value: "mobile", isRotated: false } },
};
