/**
 * Per-browser storage for which of a pattern's materials have been ticked
 * off (see MaterialsChecklist). localStorage only, for guests and
 * logged-in users alike, same as utils/rowCounters: gathering supplies is
 * a "do I have everything" aid, not checklist progress -- server-side
 * progress is keyed to the instructions' shape and drives the
 * "pattern updated" notifications, neither of which fits materials.
 *
 * Ticks are stored by the item's text rather than its position, so
 * editing the materials list (adding a line above, reordering) never moves
 * a tick onto the wrong item; an edited item simply comes back unticked.
 * Best-effort: storage being unavailable just means ticks reset on reload.
 */
const KEY_PREFIX = "yarnboard:material-checks:";

export function getMaterialChecks(patternId: number): Set<string> {
  try {
    const raw = window.localStorage.getItem(`${KEY_PREFIX}${patternId}`);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function setMaterialChecks(patternId: number, checked: Set<string>): void {
  try {
    if (checked.size === 0) {
      window.localStorage.removeItem(`${KEY_PREFIX}${patternId}`);
    } else {
      window.localStorage.setItem(`${KEY_PREFIX}${patternId}`, JSON.stringify([...checked]));
    }
  } catch {
    // Best-effort only -- see module docstring.
  }
}
