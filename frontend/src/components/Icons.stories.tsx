import type { Meta, StoryObj } from "@storybook/react-vite";
import * as Icons from "./Icons";

/** Every icon in Icons.tsx at a glance -- mainly here so the visual
 * regression run catches an accidentally broken SVG path. */
function Gallery() {
  return (
    <div className="d-flex flex-wrap gap-3 align-items-center">
      {Object.entries(Icons).map(([name, Icon]) => (
        <figure key={name} className="text-center m-0" style={{ width: 96 }}>
          <Icon />
          <figcaption className="small text-muted text-break">{name}</figcaption>
        </figure>
      ))}
    </div>
  );
}

const meta = { component: Gallery, title: "Components/Icons" } satisfies Meta<typeof Gallery>;

export default meta;
type Story = StoryObj<typeof meta>;

export const All: Story = {};
