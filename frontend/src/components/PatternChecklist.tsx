/**
 * Renders a pattern's instructions as a per-part checklist. Checking a box
 * optimistically flips local state, then persists it:
 *   - logged-in users: via the progress API, reverting the local flip if
 *     that call fails, so the UI never lies about what's actually saved.
 *   - anonymous viewers: to this browser's localStorage only (see
 *     ../utils/guestProgress) -- there's no account to store it against
 *     server-side, so it's a local-only convenience that doesn't sync
 *     across devices and is lost if this browser's storage is cleared.
 *
 * Each part can be collapsed independently (handy once you've finished a
 * section and want it out of the way), and a single "Collapse/Expand all"
 * toggle above the list controls every part at once. "Clear all checks"
 * unchecks every step (and resets every row counter) after a confirm.
 *
 * Steps follow utils/patternText's conventions: "#".."######" lines are
 * headings and "> " / "Note:" lines are notes -- neither gets a checkbox,
 * but both keep their index so progress stays aligned -- and a step that
 * starts with a row range ("Rows 5-10: ...") gets a RowCounter next to it.
 *
 * `instructionsHe`/`instructionsEn` (both optional) are pure *display*
 * overlays, shown instead of the pattern's own primary-content text when
 * the UI language matches that direction -- whichever of the two matches
 * the current UI language wins, falling back to the primary text if that
 * direction has no translation yet (see PatternDetailPage's identical
 * fallback for title/materials/abbreviations). But `part`/`index` passed
 * to toggleProgress (or cached for a guest), and every state key here,
 * always stay the pattern's own primary-content identifiers regardless
 * of what's on screen. See Pattern.instructions_he/instructions_en's
 * docstrings in backend/app/models.py for why: checklist progress is
 * keyed by the primary part name, so an overlaid-language checklist
 * would have nowhere compatible to store progress against if it used its
 * own translated keys instead of looking them up against the same
 * primary structure.
 */
import { createElement, useState } from "react";
import { Alert, Button, ButtonGroup, Card, Collapse, Form } from "react-bootstrap";
import { useTranslation } from "react-i18next";
import { clearProgress, toggleProgress } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { EnglishInstructionEntry, HebrewInstructionEntry, InstructionsMap } from "../types/models";
import { clearGuestProgress, getGuestProgress, setGuestStep } from "../utils/guestProgress";
import { parseStep, renderInlineLinks, stripStepMarker, type RowRepeat } from "../utils/patternText";
import { counterKey, getRowCounts, setRowCounts, type RowCounts } from "../utils/rowCounters";
import { NoteIcon, ResetIcon } from "./Icons";

interface Props {
  patternId: number;
  instructions: InstructionsMap;
  instructionsHe?: Record<string, HebrewInstructionEntry> | null;
  instructionsEn?: Record<string, EnglishInstructionEntry> | null;
}

/** Overlay any cached guest progress onto server-provided instructions
 * (which come back all-unchecked for a viewer with no account). No-op for
 * a logged-in user, whose completed flags already reflect their own
 * UserPatternProgress row. */
function withGuestProgress(patternId: number, instructions: InstructionsMap, isGuest: boolean): InstructionsMap {
  if (!isGuest) return instructions;
  const cached = getGuestProgress(patternId);
  const result: InstructionsMap = {};
  for (const [part, steps] of Object.entries(instructions)) {
    const flags = cached[part];
    result[part] = flags ? steps.map((s, i) => ({ ...s, completed: !!flags[i] })) : steps;
  }
  return result;
}

/** "Row 3 of 6" with -/+ buttons, for a step covering a range of rows.
 * Purely a counting aid (see utils/rowCounters) -- it never checks the
 * step's box itself; reaching the last row just highlights it. */
function RowCounter({
  repeat,
  done,
  onChange,
}: {
  repeat: RowRepeat;
  done: number;
  onChange: (next: number) => void;
}) {
  const { t } = useTranslation();
  const finished = done >= repeat.count;
  return (
    <div className="d-flex align-items-center gap-2 ms-4 mt-1 small">
      <ButtonGroup size="sm">
        <Button
          variant="outline-secondary"
          disabled={done <= 0}
          onClick={() => onChange(done - 1)}
          aria-label={t("checklist.counterDecrease")}
        >
          −
        </Button>
        <Button
          variant={finished ? "success" : "outline-primary"}
          disabled={finished}
          onClick={() => onChange(done + 1)}
          aria-label={t("checklist.counterIncrease")}
        >
          +
        </Button>
      </ButtonGroup>
      <span className={finished ? "text-success fw-semibold" : "text-muted"} aria-live="polite">
        {finished
          ? t("checklist.counterDone", { count: repeat.count })
          : t("checklist.counterProgress", { done, count: repeat.count, row: repeat.from + done })}
      </span>
    </div>
  );
}

export default function PatternChecklist({ patternId, instructions, instructionsHe, instructionsEn }: Props) {
  const { user } = useAuth();
  const { t, i18n } = useTranslation();
  const showHebrew = i18n.language === "he" && !!instructionsHe;
  const showEnglish = i18n.language === "en" && !!instructionsEn;
  const [localInstructions, setLocalInstructions] = useState(() =>
    withGuestProgress(patternId, instructions, !user),
  );
  const [collapsedParts, setCollapsedParts] = useState<Set<string>>(new Set());
  const [rowCounts, setRowCountsState] = useState<RowCounts>(() => getRowCounts(patternId));
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);

  function updateRowCount(part: string, index: number, next: number) {
    setRowCountsState((prev) => {
      const counts = { ...prev, [counterKey(part, index)]: Math.max(0, next) };
      setRowCounts(patternId, counts);
      return counts;
    });
  }

  async function handleClearAll() {
    if (!window.confirm(t("checklist.clearAllConfirm"))) return;
    setClearError(null);
    const previous = localInstructions;
    const previousCounts = rowCounts;
    setLocalInstructions((prev) =>
      Object.fromEntries(Object.entries(prev).map(([part, steps]) => [part, steps.map((s) => ({ ...s, completed: false }))])),
    );
    setRowCountsState({});
    setRowCounts(patternId, {});
    if (!user) {
      clearGuestProgress(patternId);
      return;
    }
    setClearing(true);
    try {
      await clearProgress(patternId);
    } catch {
      // Same rule as handleToggle: never show a state that isn't saved.
      // The row counters were zeroed above too, so put them back with
      // the checks.
      setLocalInstructions(previous);
      setRowCountsState(previousCounts);
      setRowCounts(patternId, previousCounts);
      setClearError(t("checklist.clearAllFailed"));
    } finally {
      setClearing(false);
    }
  }

  async function handleToggle(part: string, index: number, nextCompleted: boolean) {
    setLocalInstructions((prev) => ({
      ...prev,
      [part]: prev[part].map((s, i) => (i === index ? { ...s, completed: nextCompleted } : s)),
    }));

    if (!user) {
      // Guest: cache-only, no server round trip -- nothing to revert on
      // failure since there's no network call that can fail.
      setGuestStep(patternId, part, index, nextCompleted);
      return;
    }

    try {
      await toggleProgress(patternId, part, index, nextCompleted);
    } catch {
      // Revert on failure.
      setLocalInstructions((prev) => ({
        ...prev,
        [part]: prev[part].map((s, i) => (i === index ? { ...s, completed: !nextCompleted } : s)),
      }));
    }
  }

  function togglePart(part: string) {
    setCollapsedParts((prev) => {
      const next = new Set(prev);
      if (next.has(part)) next.delete(part);
      else next.add(part);
      return next;
    });
  }

  const parts = Object.entries(localInstructions);
  if (parts.length === 0) {
    return <p className="text-muted">{t("checklist.noInstructions")}</p>;
  }

  const allCollapsed = parts.every(([part]) => collapsedParts.has(part));
  const anyChecked = parts.some(([, steps]) => steps.some((s) => s.completed));
  const anyCounted = Object.values(rowCounts).some((n) => n > 0);

  return (
    <div className="d-flex flex-column gap-3">
      {!user && <Alert variant="light">{t("checklist.guestNotice")}</Alert>}

      <div className="d-flex flex-wrap gap-2">
        <Button
          variant="outline-secondary"
          size="sm"
          onClick={() =>
            setCollapsedParts(allCollapsed ? new Set() : new Set(parts.map(([part]) => part)))
          }
        >
          {allCollapsed ? t("checklist.expandAll") : t("checklist.collapseAll")}
        </Button>
        <Button
          variant="outline-danger"
          size="sm"
          className="d-inline-flex align-items-center gap-1"
          disabled={clearing || (!anyChecked && !anyCounted)}
          onClick={handleClearAll}
        >
          <ResetIcon size={16} />
          {t("checklist.clearAll")}
        </Button>
      </div>
      {clearError && <Alert variant="danger" className="mb-0">{clearError}</Alert>}

      {parts.map(([part, steps]) => {
        const isCollapsed = collapsedParts.has(part);
        const heading = showHebrew
          ? (instructionsHe?.[part]?.heading_he ?? part)
          : showEnglish
            ? (instructionsEn?.[part]?.heading_en ?? part)
            : part;
        return (
          <Card key={part} className="shadow-sm">
            <Card.Header
              className="bg-white fw-semibold d-flex justify-content-between align-items-center"
              dir="auto"
              role="button"
              onClick={() => togglePart(part)}
              aria-expanded={!isCollapsed}
            >
              {heading}
              <span className="text-muted">{isCollapsed ? "▸" : "▾"}</span>
            </Card.Header>
            <Collapse in={!isCollapsed}>
              <div>
                <Card.Body className="d-flex flex-column gap-2">
                  {steps.map((step, index) => {
                    // The step's kind always comes from the primary text --
                    // a translation may not have kept the "#"/">" marker.
                    const parsed = parseStep(step.step);
                    const overlay = showHebrew
                      ? instructionsHe?.[part]?.steps_he?.[index]
                      : showEnglish
                        ? instructionsEn?.[part]?.steps_en?.[index]
                        : undefined;
                    const text = overlay ? stripStepMarker(overlay) : parsed.text;

                    if (parsed.kind === "heading") {
                      // h1/h2 are taken by the page title and "Instructions",
                      // so level 1 renders as h3, level 2 as h4, and so on.
                      const tag = `h${Math.min(parsed.level + 2, 6)}`;
                      return createElement(
                        tag,
                        { key: index, dir: "auto", className: `checklist-heading checklist-heading-${parsed.level} mb-0 mt-2` },
                        renderInlineLinks(text),
                      );
                    }
                    if (parsed.kind === "note") {
                      return (
                        <div key={index} className="checklist-note d-flex gap-2 small" dir="auto">
                          <NoteIcon size={16} className="flex-shrink-0 mt-1" />
                          <span>{renderInlineLinks(text)}</span>
                        </div>
                      );
                    }
                    const key = counterKey(part, index);
                    return (
                      <div key={index}>
                        <Form.Check
                          type="checkbox"
                          id={`${part}-${index}`}
                          label={renderInlineLinks(text)}
                          dir="auto"
                          checked={step.completed}
                          onChange={(e) => handleToggle(part, index, e.target.checked)}
                        />
                        {parsed.repeat && (
                          <RowCounter
                            repeat={parsed.repeat}
                            done={Math.min(rowCounts[key] ?? 0, parsed.repeat.count)}
                            onChange={(next) => updateRowCount(part, index, Math.min(next, parsed.repeat!.count))}
                          />
                        )}
                      </div>
                    );
                  })}
                </Card.Body>
              </div>
            </Collapse>
          </Card>
        );
      })}
    </div>
  );
}
