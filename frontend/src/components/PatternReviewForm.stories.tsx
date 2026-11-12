import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, type ComponentProps } from "react";
import { expect, fn, within } from "storybook/test";
import * as fixtures from "../mocks/fixtures";
import PatternReviewForm from "./PatternReviewForm";

/** Controlled like StepListEditor -- hold the draft so edits show up. */
function Stateful(props: ComponentProps<typeof PatternReviewForm>) {
  const [draft, setDraft] = useState(props.draft);
  return (
    <div style={{ maxWidth: 720 }}>
      <PatternReviewForm
        draft={draft}
        onChange={(next) => {
          setDraft(next);
          props.onChange(next);
        }}
      />
    </div>
  );
}

/** Inline image, so stories never depend on an external site. */
const PHOTO =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160"><rect width="240" height="160" fill="#e3d5e7"/><circle cx="120" cy="80" r="40" fill="#6b3f73"/></svg>',
  );

const meta = {
  component: PatternReviewForm,
  render: (args) => <Stateful {...args} />,
  args: { draft: fixtures.draft, onChange: fn() },
} satisfies Meta<typeof PatternReviewForm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Draft: Story = {};

export const WithFoundPhoto: Story = {
  args: { draft: { ...fixtures.draft, photo_url: PHOTO } },
  play: async ({ canvas, userEvent, args }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Remove this photo" }));
    await expect(args.onChange).toHaveBeenLastCalledWith(expect.objectContaining({ photo_url: null }));
    await expect(canvas.queryByRole("img")).not.toBeInTheDocument();
  },
};

export const EditTitleAndParts: Story = {
  play: async ({ canvas, userEvent, args }) => {
    const title = canvas.getByLabelText("Title");
    await userEvent.clear(title);
    await userEvent.type(title, "Raglan, v2");
    await expect(args.onChange).toHaveBeenLastCalledWith(expect.objectContaining({ title: "Raglan, v2" }));

    await userEvent.click(canvas.getByRole("button", { name: "+ Add part" }));
    await expect(Object.keys((args.onChange as ReturnType<typeof fn>).mock.lastCall![0].instructions)).toEqual([
      "Body",
      "Sleeves",
      "Part 3",
    ]);

    await userEvent.click(canvas.getByRole("button", { name: 'Move part "Sleeves" up' }));
    await expect(Object.keys((args.onChange as ReturnType<typeof fn>).mock.lastCall![0].instructions)).toEqual([
      "Sleeves",
      "Body",
      "Part 3",
    ]);

    await userEvent.click(canvas.getByRole("button", { name: 'Delete part "Part 3"' }));
    await expect(canvas.queryByDisplayValue("Part 3")).not.toBeInTheDocument();
  },
};

export const AddStepToPart: Story = {
  play: async ({ canvas, userEvent }) => {
    const sleeves = canvas.getByLabelText('Step 1 of "Sleeves"').closest(".card") as HTMLElement;
    await userEvent.click(within(sleeves).getByRole("button", { name: "+ Add step" }));
    await expect(canvas.getByLabelText('Step 2 of "Sleeves"')).toHaveValue("");
  },
};

export const Hebrew: Story = { globals: { locale: "he" } };

export const Mobile: Story = { globals: { viewport: { value: "mobile", isRotated: false } } };
