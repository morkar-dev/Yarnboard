import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import type { ChartGrid } from "../types/models";
import PatternChartGrid from "./PatternChartGrid";

/** A 20x12 two-colour heart, plus one out-of-palette cell (drawn white). */
function heart(): ChartGrid {
  const columns = 20;
  const rows = 12;
  const cells: number[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      const nx = (x - 9.5) / 6;
      const ny = (5 - y) / 5;
      const inside = (nx * nx + ny * ny - 1) ** 3 - nx * nx * ny ** 3 <= 0;
      cells.push(inside ? 1 : 0);
    }
  }
  cells[0] = 7;
  return {
    column_count: columns,
    row_count: rows,
    palette: [
      { hex: "#f4ecf6", label: "Background" },
      { hex: "#6b3f73", label: "Eggplant" },
    ],
    cells,
  };
}

const meta = {
  component: PatternChartGrid,
  args: { grid: heart() },
} satisfies Meta<typeof PatternChartGrid>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SmallChart: Story = {
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelectorAll("tr")).toHaveLength(12);
    await expect(canvasElement.querySelectorAll("td")).toHaveLength(240);
  },
};

export const WiderThanScreen: Story = {
  args: {
    grid: { column_count: 200, row_count: 30, palette: [{ hex: "#9b6fa3", label: "Lilac" }], cells: Array(6000).fill(0) },
  },
  parameters: { viewport: { defaultViewport: "mobile" } },
};
