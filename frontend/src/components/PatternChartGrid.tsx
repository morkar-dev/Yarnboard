/** Renders a Stitch Fiddle chart's grid as an actual colored <table> --
 * one cell per stitch, matching how Stitch Fiddle's own chart view reads,
 * rather than a flattened static image. `cells` is row-major; each value
 * is a 0-indexed lookup into `palette` for that cell's color. Wrapped in
 * a scrollable box since a large chart (hundreds of cells per side) at
 * even a few pixels per cell can otherwise overflow the page.
 *
 * With `onMarkCells`, cells can be marked as worked (see ChartTracker,
 * which owns the marks and saves them):
 *   - a tap or click toggles one cell;
 *   - with a mouse, pressing and dragging marks (or, starting on a marked
 *     cell, unmarks) every cell the pointer crosses;
 *   - on a touchscreen, dragging scrolls the chart unless `dragToMark` is
 *     on, in which case it marks like a mouse drag.
 * Marked cells keep their colour under a contrasting tint. */
import { memo, useRef, type PointerEvent as ReactPointerEvent } from "react";
import type { ChartGrid, ChartGridPaletteEntry } from "../types/models";

const DEFAULT_CELL_SIZE = 8; // px
// How far a touch may move and still count as a tap rather than a scroll.
const TAP_SLOP_PX = 10;

interface Props {
  grid: ChartGrid;
  cellSize?: number;
  /** Marked cells (row-major indices). Only drawn when given. */
  marked?: ReadonlySet<number>;
  /** Called with the cells a tap or drag changed and whether they're now
   * marked. Without it the chart is view-only. */
  onMarkCells?: (cells: number[], mark: boolean) => void;
  dragToMark?: boolean;
  ariaLabel?: string;
}

/** A tint that shows on both light and dark cells: dark over light
 * colours, light over dark ones. */
function markTint(hex: string): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!match) return "rgba(0, 0, 0, 0.5)";
  const value = parseInt(match[1], 16);
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.45 ? "rgba(255, 255, 255, 0.6)" : "rgba(0, 0, 0, 0.5)";
}

interface RowProps {
  row: number;
  columnCount: number;
  cells: number[];
  palette: ChartGridPaletteEntry[];
  cellSize: number;
  /** Marked column indices in this row, as a string so React.memo can
   * skip every row a mark didn't touch (a chart can have tens of
   * thousands of cells). */
  markedKey: string;
}

const ChartRow = memo(function ChartRow({ row, columnCount, cells, palette, cellSize, markedKey }: RowProps) {
  const markedColumns = new Set(markedKey ? markedKey.split(",").map(Number) : []);
  return (
    <tr>
      {Array.from({ length: columnCount }, (_, col) => {
        const index = row * columnCount + col;
        const color = palette[cells[index]]?.hex ?? "#ffffff";
        const isMarked = markedColumns.has(col);
        return (
          <td
            key={col}
            data-cell={index}
            data-marked={isMarked || undefined}
            style={{
              width: cellSize,
              height: cellSize,
              padding: 0,
              backgroundColor: color,
              backgroundImage: isMarked
                ? `linear-gradient(${markTint(color)}, ${markTint(color)})`
                : undefined,
              // Thin cell borders, like Stitch Fiddle's own chart
              // view -- without these, small same-colored cells
              // visually blend together and the grid reads as a
              // smooth picture instead of an obvious per-cell
              // table (borderCollapse on the <table> above merges
              // adjacent cells' borders into single grid lines).
              border: "1px solid #ddd",
            }}
          />
        );
      })}
    </tr>
  );
});

/** The cells on a straight line from `from` to `to`, so a fast drag that
 * skips over cells between two pointer events still marks them. */
function cellsBetween(from: number, to: number, columnCount: number): number[] {
  const [r0, c0] = [Math.floor(from / columnCount), from % columnCount];
  const [r1, c1] = [Math.floor(to / columnCount), to % columnCount];
  const steps = Math.max(Math.abs(r1 - r0), Math.abs(c1 - c0));
  const result: number[] = [];
  for (let i = 1; i <= steps; i++) {
    const r = Math.round(r0 + ((r1 - r0) * i) / steps);
    const c = Math.round(c0 + ((c1 - c0) * i) / steps);
    result.push(r * columnCount + c);
  }
  return result;
}

function cellAt(x: number, y: number): number | null {
  const target = document.elementFromPoint(x, y);
  const value = target instanceof HTMLElement ? target.closest("td[data-cell]")?.getAttribute("data-cell") : null;
  return value == null ? null : Number(value);
}

export default function PatternChartGrid({
  grid,
  cellSize = DEFAULT_CELL_SIZE,
  marked,
  onMarkCells,
  dragToMark = false,
  ariaLabel,
}: Props) {
  const { column_count, row_count, palette, cells } = grid;
  // A drag in progress: whether it marks or unmarks, and the last cell it
  // reached. `tap` is a touch that may still turn out to be a scroll.
  const drag = useRef<{ mark: boolean; last: number } | null>(null);
  const tap = useRef<{ cell: number; x: number; y: number } | null>(null);
  const interactive = !!onMarkCells;

  const markedByRow: string[] = Array(row_count).fill("");
  if (marked) {
    const perRow: number[][] = Array.from({ length: row_count }, () => []);
    for (const index of marked) {
      const row = Math.floor(index / column_count);
      if (row >= 0 && row < row_count) perRow[row].push(index % column_count);
    }
    perRow.forEach((columns, row) => {
      markedByRow[row] = columns.sort((a, b) => a - b).join(",");
    });
  }

  function apply(changed: number[], mark: boolean) {
    const effective = changed.filter((cell) => (marked?.has(cell) ?? false) !== mark);
    if (effective.length) onMarkCells?.(effective, mark);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLTableElement>) {
    if (!interactive || event.button !== 0) return;
    const cell = cellAt(event.clientX, event.clientY);
    if (cell == null) return;
    const mark = !(marked?.has(cell) ?? false);
    if (event.pointerType === "mouse" || dragToMark) {
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      drag.current = { mark, last: cell };
      apply([cell], mark);
    } else {
      tap.current = { cell, x: event.clientX, y: event.clientY };
    }
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLTableElement>) {
    if (tap.current && Math.hypot(event.clientX - tap.current.x, event.clientY - tap.current.y) > TAP_SLOP_PX) {
      tap.current = null; // it's a scroll
    }
    const current = drag.current;
    if (!current) return;
    const cell = cellAt(event.clientX, event.clientY);
    if (cell == null || cell === current.last) return;
    apply(cellsBetween(current.last, cell, column_count), current.mark);
    current.last = cell;
  }

  function handlePointerUp() {
    if (tap.current) {
      const { cell } = tap.current;
      apply([cell], !(marked?.has(cell) ?? false));
    }
    tap.current = null;
    drag.current = null;
  }

  function handlePointerCancel() {
    tap.current = null;
    drag.current = null;
  }

  return (
    <div style={{ overflow: "auto", maxWidth: "100%", maxHeight: "70vh" }} className="mb-3">
      <table
        aria-label={ariaLabel}
        onPointerDown={interactive ? handlePointerDown : undefined}
        onPointerMove={interactive ? handlePointerMove : undefined}
        onPointerUp={interactive ? handlePointerUp : undefined}
        onPointerCancel={interactive ? handlePointerCancel : undefined}
        style={{
          borderCollapse: "collapse",
          width: column_count * cellSize,
          height: row_count * cellSize,
          ...(interactive && {
            cursor: "pointer",
            userSelect: "none",
            // Dragging scrolls the chart on a touchscreen unless drag-to-
            // mark is on (see the component docstring).
            touchAction: dragToMark ? "none" : "auto",
          }),
        }}
      >
        <tbody>
          {Array.from({ length: row_count }, (_, row) => (
            <ChartRow
              key={row}
              row={row}
              columnCount={column_count}
              cells={cells}
              palette={palette}
              cellSize={cellSize}
              markedKey={markedByRow[row]}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
