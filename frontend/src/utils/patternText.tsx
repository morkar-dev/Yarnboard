/**
 * The small text conventions a pattern's stored strings carry -- kept as
 * plain strings in the DB (and in translations) so nothing about the
 * storage format or checklist progress indexing changes:
 *
 *   Instruction steps (one string each):
 *     "# Body", "## Decreases", ... "###### x"  -> a heading (level = # count),
 *                                                not checkable
 *     "> Use a stitch marker here"             -> a note, not checkable
 *     "Note: ..." / "הערה: ..."                -> also a note
 *     "Rows 5-10: knit" / "5–10. k2, p2"       -> a normal step that also gets
 *                                                a repeat counter (6 rows)
 *
 *   Materials (one item per line): "[Drops Air](https://...)" markdown links
 *   render as hyperlinks -- the scraper writes these for links the source
 *   page had (see backend/app/scraper.py's _linearize), and editors can
 *   type them by hand. Leading "-", "*", "•" bullets are stripped since the
 *   page renders its own list.
 *
 * Headings and notes still occupy an index in their part's steps array, so
 * every step keeps the same index it would have had without them --
 * checklist progress (keyed by part + index) is unaffected.
 */
import type { ReactNode } from "react";

export type ParsedStep =
  | { kind: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { kind: "note"; text: string }
  | { kind: "step"; text: string; repeat: RowRepeat | null };

export interface RowRepeat {
  from: number;
  to: number;
  /** Rows in the range, inclusive (5-10 is 6 rows). */
  count: number;
}

const HEADING_RE = /^(#{1,6})\s+(.+)$/;
const NOTE_MARKER_RE = /^>\s?(.*)$/;
const NOTE_WORD_RE = /^(note|notes|tip|הערה|הערות|טיפ)\s*:/i;
// An optional "Row(s)/Rnd(s)/Round(s)/R" (or Hebrew שורה/שורות/סיבוב/סיבובים)
// word, then "n1-n2" at the very start of the step. Any of -, – or —.
const REPEAT_RE =
  /^\s*(?:(?:rows?|rnds?|rounds?|r|שורות|שורה|סיבובים|סיבוב)\s*)?(\d+)\s*[-–—]\s*(\d+)(?!\d)/i;
// Guards against a typo or an unrelated number pair turning into a
// thousand-row counter.
const MAX_REPEAT_COUNT = 500;

export function parseRepeat(text: string): RowRepeat | null {
  const match = REPEAT_RE.exec(text);
  if (!match) return null;
  const from = Number(match[1]);
  const to = Number(match[2]);
  if (!(to > from) || to - from + 1 > MAX_REPEAT_COUNT) return null;
  return { from, to, count: to - from + 1 };
}

export function parseStep(raw: string): ParsedStep {
  const text = raw.trim();
  const heading = HEADING_RE.exec(text);
  if (heading) {
    return { kind: "heading", level: heading[1].length as 1 | 2 | 3 | 4 | 5 | 6, text: heading[2].trim() };
  }
  const note = NOTE_MARKER_RE.exec(text);
  if (note) return { kind: "note", text: note[1].trim() };
  if (NOTE_WORD_RE.test(text)) return { kind: "note", text };
  return { kind: "step", text, repeat: parseRepeat(text) };
}

/** The display text of a (possibly translated) step with any heading/note
 * marker removed -- used for a translation overlay, whose marker may or
 * may not have survived machine translation. */
export function stripStepMarker(raw: string): string {
  const text = raw.trim();
  const heading = HEADING_RE.exec(text);
  if (heading) return heading[2].trim();
  const note = NOTE_MARKER_RE.exec(text);
  return note ? note[1].trim() : text;
}

const LINK_RE = /\[([^[\]]*)\]\((https?:\/\/[^)\s]+)\)/g;

/** `text` with markdown links rendered as real <a> tags (http/https only,
 * opened in a new tab). Everything else stays plain text -- no other
 * markdown, and never raw HTML. */
export function renderInlineLinks(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(LINK_RE)) {
    const index = match.index ?? 0;
    if (index > last) nodes.push(text.slice(last, index));
    nodes.push(
      <a key={index} href={match[2]} target="_blank" rel="noopener noreferrer">
        {match[1] || match[2]}
      </a>,
    );
    last = index + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/** Materials text -> one list item per non-empty line, bullets and
 * numbering stripped (they're just list formatting there). */
export function parseListItems(text: string): string[] {
  return parseLines(text).map((line) => line.replace(/^(?:[-*•·]|\d+[.)])\s+/, "").trim()).filter(Boolean);
}

/** One entry per non-empty line, kept exactly as written apart from
 * surrounding whitespace -- for abbreviations, where a leading "*" or "-"
 * is often the symbol being defined ("* = repeat from"), not a bullet. */
export function parseLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}
