/**
 * A pattern's Stitch Fiddle chart (PatternChartGrid) that the crafter can
 * mark cell by cell as they work it, plus a small toolbar: zoom, a
 * drag-to-mark switch for touchscreens, how many cells are marked, and
 * "Clear marks".
 *
 * Marks are saved like checklist progress (see PatternChecklist):
 *   - logged-in users: to their account (PUT /api/patterns/<id>/chart-marks,
 *     the whole set). Changes are applied at once and saved after a short
 *     pause, so a drag across many cells is one request; a save still
 *     waiting when the page closes or the tracker unmounts is sent right
 *     away. If saving fails the marks go back to what was last saved and
 *     an error shows.
 * The parent mounts this only once the login state is known, keyed by
 * account (see PatternDetailPage), so it always starts from the right
 * person's marks.
 *   - guests: to this browser only (utils/guestChartMarks).
 * The zoom level is remembered per browser for every chart.
 */
import { useEffect, useRef, useState } from "react";
import { Alert, Button, ButtonGroup, Form } from "react-bootstrap";
import { useTranslation } from "react-i18next";
import { saveChartMarks } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { ChartGrid } from "../types/models";
import { getGuestChartMarks, setGuestChartMarks } from "../utils/guestChartMarks";
import PatternChartGrid from "./PatternChartGrid";

const ZOOM_LEVELS = [8, 16, 24] as const;
const ZOOM_KEY = "yarnboard:chart-zoom";
const SAVE_DELAY_MS = 600;

function storedZoom(): number {
  try {
    const value = Number(window.localStorage.getItem(ZOOM_KEY));
    return (ZOOM_LEVELS as readonly number[]).includes(value) ? value : ZOOM_LEVELS[0];
  } catch {
    return ZOOM_LEVELS[0];
  }
}

interface Props {
  patternId: number;
  grid: ChartGrid;
}

export default function ChartTracker({ patternId, grid }: Props) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const shape = `${grid.column_count}x${grid.row_count}`;
  const total = grid.column_count * grid.row_count;

  const [marked, setMarked] = useState<Set<number>>(
    () => new Set(user ? (grid.marked_cells ?? []) : getGuestChartMarks(patternId, shape)),
  );
  const [cellSize, setCellSize] = useState(storedZoom);
  const [dragToMark, setDragToMark] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // What the server has, to fall back to when a save fails.
  const saved = useRef<Set<number>>(new Set(grid.marked_cells ?? []));
  // A save waiting for the pause to end: its timer and the marks it sends.
  const pending = useRef<{ timer: number; cells: Set<number> } | null>(null);

  // Send a waiting save now -- when the page is hidden or closed, or the
  // tracker goes away -- instead of losing it with its timer.
  useEffect(() => {
    function flush() {
      if (!pending.current) return;
      window.clearTimeout(pending.current.timer);
      const cells = [...pending.current.cells];
      pending.current = null;
      saveChartMarks(patternId, cells, shape, { keepalive: true }).catch(() => {
        // The page is going away; there's nothing left to show an error on.
      });
    }
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [patternId, shape]);

  function persist(next: Set<number>) {
    if (!user) {
      setGuestChartMarks(patternId, shape, [...next].sort((a, b) => a - b));
      return;
    }
    if (pending.current) window.clearTimeout(pending.current.timer);
    const timer = window.setTimeout(async () => {
      pending.current = null;
      try {
        const response = await saveChartMarks(patternId, [...next], shape);
        saved.current = new Set(response.marked_cells);
        setSaveError(null);
      } catch {
        setMarked(new Set(saved.current));
        setSaveError(t("chartTracker.saveFailed"));
      }
    }, SAVE_DELAY_MS);
    pending.current = { timer, cells: next };
  }

  function handleMarkCells(cells: number[], mark: boolean) {
    setMarked((prev) => {
      const next = new Set(prev);
      for (const cell of cells) {
        if (mark) next.add(cell);
        else next.delete(cell);
      }
      persist(next);
      return next;
    });
  }

  function handleClear() {
    if (!window.confirm(t("chartTracker.clearConfirm"))) return;
    const next = new Set<number>();
    setMarked(next);
    persist(next);
  }

  function handleZoom(size: number) {
    setCellSize(size);
    try {
      window.localStorage.setItem(ZOOM_KEY, String(size));
    } catch {
      // Best-effort: the zoom just isn't remembered.
    }
  }

  return (
    <div className="mb-3">
      <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
        <ButtonGroup size="sm" aria-label={t("chartTracker.zoom")}>
          {ZOOM_LEVELS.map((size, i) => (
            <Button
              key={size}
              variant={cellSize === size ? "primary" : "outline-primary"}
              aria-pressed={cellSize === size}
              onClick={() => handleZoom(size)}
            >
              {t(`chartTracker.zoom${i + 1}`)}
            </Button>
          ))}
        </ButtonGroup>
        <Form.Check
          type="switch"
          id={`chart-drag-${patternId}`}
          label={t("chartTracker.dragToMark")}
          checked={dragToMark}
          onChange={(e) => setDragToMark(e.currentTarget.checked)}
        />
        <span className="text-muted small" aria-live="polite">
          {t("chartTracker.count", { marked: marked.size, total })}
        </span>
        {marked.size > 0 && (
          <Button variant="outline-secondary" size="sm" className="ms-auto" onClick={handleClear}>
            {t("chartTracker.clear")}
          </Button>
        )}
      </div>
      <p className="text-muted small mb-2">
        {t("chartTracker.hint")} {!user && t("chartTracker.guestNotice")}
      </p>
      {saveError && (
        <Alert variant="danger" className="py-2">
          {saveError}
        </Alert>
      )}
      <PatternChartGrid
        grid={grid}
        cellSize={cellSize}
        marked={marked}
        onMarkCells={handleMarkCells}
        dragToMark={dragToMark}
        ariaLabel={t("chartTracker.label")}
      />
    </div>
  );
}
