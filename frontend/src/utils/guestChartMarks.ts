/**
 * Marked chart cells (see ChartTracker) for anonymous viewers, kept in this
 * browser's localStorage -- there's no account to save a UserChartProgress
 * row against. Stored with the chart's "<columns>x<rows>" shape, the same
 * guard the server uses: cell indices only mean something for that shape.
 * Best-effort like utils/guestProgress: unavailable storage just means
 * marks reset on reload, never a crash.
 */
const KEY_PREFIX = "yarnboard:guest-chart-marks:";

interface Stored {
  shape: string;
  cells: number[];
}

export function getGuestChartMarks(patternId: number, shape: string): number[] {
  try {
    const raw = window.localStorage.getItem(`${KEY_PREFIX}${patternId}`);
    const stored = raw ? (JSON.parse(raw) as Stored) : null;
    return stored && stored.shape === shape && Array.isArray(stored.cells) ? stored.cells : [];
  } catch {
    return [];
  }
}

export function setGuestChartMarks(patternId: number, shape: string, cells: number[]): void {
  try {
    if (cells.length === 0) {
      window.localStorage.removeItem(`${KEY_PREFIX}${patternId}`);
    } else {
      window.localStorage.setItem(`${KEY_PREFIX}${patternId}`, JSON.stringify({ shape, cells } satisfies Stored));
    }
  } catch {
    // Best-effort only -- see module docstring.
  }
}
