"""
Regression harness for the pattern parsers: one folder per real-world
pattern under cases/, each saying what the input is and what the parsed
draft should contain. test_regression.py runs every case; record.py
creates cases and captures their inputs. See README.md in this folder.

Kept free of pytest imports so record.py can reuse it as a plain script.
"""
from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from pathlib import Path

CASES_DIR = Path(__file__).parent / "cases"

# What each input kind reads, offline, when case.json names no "input".
DEFAULT_INPUT = {
    "html": "page.html",       # a saved web page (what /preview-upload gets)
    "pdf": "pattern.pdf",      # a PDF (also /preview-upload)
    "text": "pattern.txt",     # pasted text (/preview-text)
    "url": "page.html",        # snapshot of the live page (record.py snapshot)
    "photos": "transcript.txt",  # Gemini's transcription (record.py transcribe)
}
KINDS = tuple(DEFAULT_INPUT)

# Live mode re-does the step that depends on the outside world -- fetching
# the real page, or asking Gemini to read the photos -- instead of using
# the saved snapshot/transcript. Opt-in: needs network (and for photos a
# GEMINI_API_KEY), and a live site can change at any time.
LIVE_KINDS = ("url", "photos")
PHOTO_SUFFIXES = (".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif")

DRAFT_FIELDS = (
    "title", "author", "materials", "abbreviations", "instructions",
    "source_site_name", "source_domain", "photo_url",
)
TEXT_OPERATORS = {"equals", "contains", "not_contains", "lines", "present", "matches"}
INSTRUCTION_OPERATORS = {"equals", "parts", "not_parts", "steps", "step_count", "step_contains", "present"}
CASE_KEYS = {"description", "kind", "source_url", "input", "photos", "xfail", "expect", "notes"}


class CaseError(Exception):
    """case.json is malformed, or an input file it needs is missing."""


@dataclass
class Case:
    id: str
    dir: Path
    kind: str
    description: str = ""
    source_url: str | None = None
    input: str | list[str] | None = None
    photos: list[str] = field(default_factory=list)
    xfail: str | None = None
    expect: dict | None = None

    @property
    def input_files(self) -> list[Path]:
        names = self.input or DEFAULT_INPUT[self.kind]
        return [self.dir / n for n in ([names] if isinstance(names, str) else names)]

    @property
    def photo_files(self) -> list[Path]:
        if self.photos:
            return [self.dir / n for n in self.photos]
        return sorted(p for p in self.dir.iterdir() if p.suffix.lower() in PHOTO_SUFFIXES)


def load_case(case_dir: Path) -> Case:
    path = case_dir / "case.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise CaseError(f"{case_dir.name}: no case.json") from None
    except json.JSONDecodeError as exc:
        raise CaseError(f"{case_dir.name}: case.json isn't valid JSON: {exc}") from None

    unknown = set(data) - CASE_KEYS
    if unknown:
        raise CaseError(f"{case_dir.name}: unknown key(s) in case.json: {sorted(unknown)}")
    kind = data.get("kind")
    if kind not in KINDS:
        raise CaseError(f"{case_dir.name}: \"kind\" must be one of {list(KINDS)}, got {kind!r}")
    if kind in ("html", "url") and not data.get("source_url"):
        raise CaseError(f"{case_dir.name}: \"source_url\" is required for kind {kind!r}")

    case = Case(
        id=case_dir.name,
        dir=case_dir,
        kind=kind,
        description=data.get("description", ""),
        source_url=data.get("source_url"),
        input=data.get("input"),
        photos=data.get("photos") or [],
        xfail=data.get("xfail"),
        expect=data.get("expect"),
    )
    if case.expect is not None:
        validate_expect(case.id, case.expect)
    return case


def all_cases() -> list[Path]:
    """Every case folder, sorted; names starting with "_" are ignored (use
    that for work in progress you don't want run yet)."""
    if not CASES_DIR.is_dir():
        return []
    return sorted(p for p in CASES_DIR.iterdir() if p.is_dir() and not p.name.startswith(("_", ".")))


def validate_expect(case_id: str, expect: dict) -> None:
    if not isinstance(expect, dict):
        raise CaseError(f"{case_id}: \"expect\" must be an object")
    for name, spec in expect.items():
        if name not in DRAFT_FIELDS:
            raise CaseError(f"{case_id}: \"expect\" has unknown field {name!r} (fields: {list(DRAFT_FIELDS)})")
        if not isinstance(spec, dict):
            continue  # a plain value means "exactly this"
        allowed = INSTRUCTION_OPERATORS if name == "instructions" else TEXT_OPERATORS
        if name == "instructions" and not (set(spec) & INSTRUCTION_OPERATORS):
            continue  # a plain {part: [steps]} object means "exactly this"
        bad = set(spec) - allowed
        if bad:
            raise CaseError(
                f"{case_id}: \"expect.{name}\" has unknown check(s) {sorted(bad)} (allowed: {sorted(allowed)})"
            )


# --- Running the parser -------------------------------------------------------


def parse(case: Case, *, live: bool = False) -> dict:
    """The draft the app would build for this case's input."""
    from app.scraper import parse_pattern_html, parse_pattern_pdf, parse_pattern_text

    if live:
        if case.kind == "url":
            from app.scraper import _fetch_html

            return parse_pattern_html(_fetch_html(case.source_url), case.source_url)
        if case.kind == "photos":
            return parse_pattern_text(transcribe(case), case.source_url)
        raise CaseError(f"{case.id}: kind {case.kind!r} has no live mode")

    files = case.input_files
    missing = [f.name for f in files if not f.is_file()]
    if missing:
        hint = {
            "url": f"  Capture it with: python tests/regression/record.py snapshot {case.id}",
            "photos": f"  Capture it with: python tests/regression/record.py transcribe {case.id}",
        }.get(case.kind, "")
        raise CaseError(f"{case.id}: missing input file(s) {missing}.{hint}")

    if case.kind in ("html", "url"):
        return parse_pattern_html(_read_text(files[0]), case.source_url)
    if case.kind == "pdf":
        return parse_pattern_pdf(files[0].read_bytes(), case.source_url)
    # text / photos (a transcript is just text)
    text = "\n".join(_read_text(f) for f in files)
    return parse_pattern_text(text, case.source_url)


def transcribe(case: Case) -> str:
    """Ask Gemini to read this case's photos, exactly as POST
    /api/patterns/preview-photos does (same normalizing, same prompt)."""
    from app import photo, transcription

    if not os.environ.get("GEMINI_API_KEY"):
        raise CaseError("GEMINI_API_KEY isn't set -- needed to read photos")
    photos = case.photo_files
    if not photos:
        raise CaseError(f"{case.id}: no photos in the case folder (add {', '.join(PHOTO_SUFFIXES)} files)")
    images = [photo.process_upload(p.read_bytes()) for p in photos]
    return transcription.transcribe_pattern_photos(images)


def _read_text(path: Path) -> str:
    return path.read_bytes().decode("utf-8", errors="replace")


# --- Checking the result ------------------------------------------------------


def _norm(text) -> str:
    return re.sub(r"\s+", " ", str(text)).strip()


def _lines(text) -> list[str]:
    return [_norm(line) for line in (text or "").splitlines() if line.strip()]


def check(draft: dict, expect: dict) -> list[str]:
    """Every way `draft` differs from `expect` (empty list = pass). All
    mismatches are reported, not just the first, so one run shows the
    whole picture for a case."""
    problems: list[str] = []
    for name, spec in expect.items():
        actual = draft.get(name)
        if name == "instructions":
            problems += _check_instructions(actual or {}, spec)
        else:
            problems += _check_text(name, actual, spec)
    return problems


def _check_text(name: str, actual, spec) -> list[str]:
    if not isinstance(spec, dict):
        spec = {"equals": spec}
    out = []
    if "equals" in spec:
        want = spec["equals"]
        if want is None or actual is None:
            if want != actual:
                out.append(f"{name}: expected {want!r}, got {actual!r}")
        elif _norm(want) != _norm(actual):
            out.append(f"{name}: expected {_norm(want)!r}, got {_norm(actual)!r}")
    if "present" in spec and bool(actual) != bool(spec["present"]):
        out.append(f"{name}: expected it to be {'present' if spec['present'] else 'empty'}, got {actual!r}")
    for needle in _as_list(spec.get("contains")):
        if _norm(needle).lower() not in _norm(actual or "").lower():
            out.append(f"{name}: should contain {needle!r} -- got {_norm(actual or '')[:300]!r}")
    for needle in _as_list(spec.get("not_contains")):
        if _norm(needle).lower() in _norm(actual or "").lower():
            out.append(f"{name}: should NOT contain {needle!r}")
    if "lines" in spec:
        want, got = [_norm(x) for x in spec["lines"]], _lines(actual)
        if want != got:
            out.append(f"{name}: lines differ\n{_list_diff(want, got)}")
    if "matches" in spec and not re.search(spec["matches"], actual or "", re.MULTILINE):
        out.append(f"{name}: should match /{spec['matches']}/ -- got {(actual or '')[:300]!r}")
    return out


def _check_instructions(actual: dict, spec) -> list[str]:
    if not (isinstance(spec, dict) and set(spec) & INSTRUCTION_OPERATORS):
        spec = {"equals": spec}
    norm = {part: [_norm(s) for s in steps] for part, steps in actual.items()}
    out = []
    if "present" in spec and bool(actual) != bool(spec["present"]):
        out.append(f"instructions: expected {'some' if spec['present'] else 'none'}, got {len(actual)} part(s)")
    if "equals" in spec:
        want = {part: [_norm(s) for s in steps] for part, steps in spec["equals"].items()}
        if list(want) != list(norm):
            out.append(f"instructions: parts differ\n{_list_diff(list(want), list(norm))}")
        for part in want:
            if part in norm and want[part] != norm[part]:
                out.append(f"instructions[{part!r}]: steps differ\n{_list_diff(want[part], norm[part])}")
    if "parts" in spec and [_norm(p) for p in spec["parts"]] != [_norm(p) for p in norm]:
        out.append(f"instructions: parts differ\n{_list_diff([_norm(p) for p in spec['parts']], list(norm))}")
    for part in _as_list(spec.get("not_parts")):
        if _norm(part) in {_norm(p) for p in norm}:
            out.append(f"instructions: should NOT have a part {part!r}")
    for part, steps in (spec.get("steps") or {}).items():
        if part not in norm:
            out.append(f"instructions: missing part {part!r} (parts: {list(norm)})")
        elif [_norm(s) for s in steps] != norm[part]:
            out.append(f"instructions[{part!r}]: steps differ\n{_list_diff([_norm(s) for s in steps], norm[part])}")
    for part, count in (spec.get("step_count") or {}).items():
        got = len(norm.get(part, []))
        if part not in norm:
            out.append(f"instructions: missing part {part!r} (parts: {list(norm)})")
        elif got != count:
            out.append(f"instructions[{part!r}]: expected {count} steps, got {got}")
    for part, needles in (spec.get("step_contains") or {}).items():
        joined = "\n".join(norm.get(part, [])).lower()
        if part not in norm:
            out.append(f"instructions: missing part {part!r} (parts: {list(norm)})")
            continue
        for needle in _as_list(needles):
            if _norm(needle).lower() not in joined:
                out.append(f"instructions[{part!r}]: no step contains {needle!r}")
    return out


def _as_list(value) -> list:
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def _list_diff(want: list[str], got: list[str]) -> str:
    import difflib

    diff = difflib.unified_diff(want, got, "expected", "actual", lineterm="", n=1)
    return "\n".join("    " + line for line in diff)
