import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, type ComponentProps } from "react";
import { expect, fn } from "storybook/test";
import { t } from "../mocks/text";
import StepListEditor from "./StepListEditor";

/** StepListEditor is controlled -- this wrapper holds the lines so the
 * story behaves like it does inside PatternReviewForm, while `onChange`
 * still records every call for the play assertions. */
function Stateful(props: ComponentProps<typeof StepListEditor>) {
  const [lines, setLines] = useState(props.lines);
  return (
    <div className="d-grid gap-2" style={{ maxWidth: 480 }}>
      <StepListEditor
        {...props}
        lines={lines}
        onChange={(next) => {
          setLines(next);
          props.onChange(next);
        }}
      />
    </div>
  );
}

const meta = {
  component: StepListEditor,
  render: (args) => <Stateful {...args} />,
  args: {
    lines: ["Cast on 120 stitches.", "Knit 2x2 rib for 5 cm."],
    onChange: fn(),
    addLabel: "+ Add step",
    inputLabel: (n: number) => `Step ${n}`,
    deleteLabel: (n: number) => `Delete step ${n}`,
  },
} satisfies Meta<typeof StepListEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Filled: Story = {};

export const Empty: Story = { args: { lines: [] } };

export const SoleEmptyLineKept: Story = {
  args: { lines: [""], keepOneLine: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByLabelText("Step 1")).toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: "Delete step 1" })).not.toBeInTheDocument();
  },
};

export const EditAddAndDelete: Story = {
  play: async ({ canvas, userEvent, args }) => {
    const step2 = canvas.getByLabelText("Step 2");
    await userEvent.clear(step2);
    await userEvent.type(step2, "Purl one round.");
    await expect(step2).toHaveValue("Purl one round.");

    await userEvent.click(canvas.getByRole("button", { name: "Delete step 1" }));
    await expect(canvas.getByLabelText("Step 1")).toHaveValue("Purl one round.");

    await userEvent.click(canvas.getByRole("button", { name: t("reviewForm.addHeading") }));
    await expect(canvas.getByLabelText("Step 2")).toHaveValue("## ");

    await userEvent.click(canvas.getByRole("button", { name: t("reviewForm.addNote") }));
    await expect(args.onChange).toHaveBeenLastCalledWith(["Purl one round.", "## ", "> "]);
  },
};
