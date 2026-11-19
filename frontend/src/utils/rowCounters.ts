/**
 * Per-browser storage for the repeat-row counters on a pattern's checklist
 * (see PatternChecklist's RowCounter and utils/patternText's parseRepeat).
 * localStorage only, for guests and logged-in users alike: a counter is a
 * "where am I right now" aid while working, not progress worth syncing --
 * the step's checkbox is still the real, synced record. Best-effort like
 * guestProgress: storage being unavailable just means counters reset on
 * reload.
 */
const KEY_PREFIX = "yarnboard:row-counters:";

/** `${part}::${index}` -> rows done so far */
export type RowCounts = Record<string, number>;

export function counterKey(part: string, index: number): string {
  return `${part}::${index}`;
}

export function getRowCounts(patternId: number): RowCounts {
  try {
    const raw = window.localStorage.getItem(`${KEY_PREFIX}${patternId}`);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function setRowCounts(patternId: number, counts: RowCounts): void {
  try {
    if (Object.keys(counts).length === 0) {
      window.localStorage.removeItem(`${KEY_PREFIX}${patternId}`);
    } else {
      window.localStorage.setItem(`${KEY_PREFIX}${patternId}`, JSON.stringify(counts));
    }
  } catch {
    // Best-effort only -- see module docstring.
  }
}
