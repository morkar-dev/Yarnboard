"""
Helper for adding parser regression cases (see README.md in this folder).
Run from backend/ with the venv's Python:

    python tests/regression/record.py new <case-id> --kind url --url https://...
    python tests/regression/record.py snapshot <case-id>     # url: save today's page as page.html
    python tests/regression/record.py transcribe <case-id>   # photos: save Gemini's reading as transcript.txt
    python tests/regression/record.py show <case-id>         # print what the parser produces now
    python tests/regression/record.py show <case-id> --draft # ...and save it as expect.draft.json

`show --draft` is only a starting point for writing "expect": it records
whatever the parser does today, bugs included. Copy the parts that are
right into case.json's "expect", fix the parts that aren't, and delete the
draft file.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent.parent))  # backend/, for `import app`

from harness import CASES_DIR, DEFAULT_INPUT, KINDS, CaseError, load_case, parse, transcribe  # noqa: E402


def cmd_new(args) -> None:
    case_dir = CASES_DIR / args.case_id
    if case_dir.exists():
        sys.exit(f"{case_dir} already exists")
    if args.kind in ("html", "pdf", "url") and not args.url:
        sys.exit(f"--url is required for kind {args.kind!r} (the page the pattern came from)")
    case_dir.mkdir(parents=True)
    case = {
        "description": args.description or "TODO: what this pattern is and why it's a useful case",
        "kind": args.kind,
        **({"source_url": args.url} if args.url else {}),
        "expect": {},
    }
    (case_dir / "case.json").write_text(json.dumps(case, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    needs = {
        "html": "save the page as page.html in this folder",
        "pdf": "put the PDF here as pattern.pdf",
        "text": "put the pasted text here as pattern.txt",
        "url": f"run: python tests/regression/record.py snapshot {args.case_id}",
        "photos": f"add the photos (in page order by file name), then run: "
                  f"python tests/regression/record.py transcribe {args.case_id}",
    }[args.kind]
    print(f"Created {case_dir.relative_to(Path.cwd()) if case_dir.is_relative_to(Path.cwd()) else case_dir}")
    print(f"Next: {needs}, then fill in \"expect\" (show --draft helps).")


def cmd_snapshot(args) -> None:
    case = _case(args.case_id)
    if case.kind != "url":
        sys.exit(f"{case.id} is kind {case.kind!r}; snapshot is only for url cases")
    from app.scraper import _fetch_html

    html = _fetch_html(case.source_url)
    target = case.input_files[0]
    target.write_text(html, encoding="utf-8")
    print(f"Saved {len(html):,} characters of {case.source_url} to {target.name}")


def cmd_transcribe(args) -> None:
    case = _case(args.case_id)
    if case.kind != "photos":
        sys.exit(f"{case.id} is kind {case.kind!r}; transcribe is only for photos cases")
    text = transcribe(case)
    target = case.input_files[0]
    target.write_text(text, encoding="utf-8")
    print(f"Saved Gemini's transcription ({len(text.splitlines())} lines) to {target.name}")


def cmd_show(args) -> None:
    case = _case(args.case_id)
    draft = parse(case, live=args.live)
    out = json.dumps(draft, ensure_ascii=False, indent=2)
    print(out)
    if args.draft:
        (case.dir / "expect.draft.json").write_text(out + "\n", encoding="utf-8")
        print(f"\nSaved to {case.dir.name}/expect.draft.json -- review it before copying into \"expect\".",
              file=sys.stderr)


def _case(case_id: str):
    case_dir = CASES_DIR / case_id
    if not case_dir.is_dir():
        sys.exit(f"No case folder {case_dir}")
    try:
        return load_case(case_dir)
    except CaseError as exc:
        sys.exit(str(exc))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    new = sub.add_parser("new", help="create a case folder with a case.json to fill in")
    new.add_argument("case_id", help="folder name, e.g. drops-air-raglan-url")
    new.add_argument("--kind", required=True, choices=KINDS,
                     help=", ".join(f"{k} (reads {v})" for k, v in DEFAULT_INPUT.items()))
    new.add_argument("--url", help="where the pattern came from (required for html/pdf/url)")
    new.add_argument("--description")
    new.set_defaults(func=cmd_new)

    snap = sub.add_parser("snapshot", help="url cases: save the live page as page.html")
    snap.add_argument("case_id")
    snap.set_defaults(func=cmd_snapshot)

    tr = sub.add_parser("transcribe", help="photos cases: save Gemini's transcription as transcript.txt")
    tr.add_argument("case_id")
    tr.set_defaults(func=cmd_transcribe)

    show = sub.add_parser("show", help="print what the parser produces for a case now")
    show.add_argument("case_id")
    show.add_argument("--live", action="store_true", help="re-fetch the page / re-read the photos first")
    show.add_argument("--draft", action="store_true", help="also save it as expect.draft.json")
    show.set_defaults(func=cmd_show)

    args = parser.parse_args()
    try:
        args.func(args)
    except CaseError as exc:
        sys.exit(str(exc))


if __name__ == "__main__":
    main()
