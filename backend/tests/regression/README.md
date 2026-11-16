# Parser regression cases

Real patterns, and what the app should extract from each, checked on
every `pytest` run (and so in CI's `backend-tests` job). When a parser
change breaks a pattern that used to work, the case for it fails and says
exactly which field changed.

```bash
cd backend
.venv/bin/python -m pytest tests/regression                    # offline, a second or two
REGRESSION_LIVE=1 .venv/bin/python -m pytest tests/regression  # + live pages / Gemini
```

## One folder per pattern

```
cases/<case-id>/
  case.json         what the input is + what the result must contain
  <input file(s)>   see "kind" below
  actual.json       written when the case fails: what the parser produced (git-ignored)
```

`case-id` is the folder name: lowercase, describe the pattern and the
input, e.g. `drops-air-raglan-url`, `grandmas-dishcloth-photos`. Folders
starting with `_` are skipped (work in progress). The `example-*` folders
are format references -- copy one to start.

### `kind`: what kind of input, and which file is read

| kind | what it is | file read on a normal run | `source_url` |
|---|---|---|---|
| `url` | a link pasted on Submit | `page.html`, a snapshot of the live page (`record.py snapshot`) | required |
| `html` | a saved web page uploaded on Submit | `page.html` | required |
| `pdf` | a PDF uploaded on Submit | `pattern.pdf` | optional (the author comes from the file) |
| `text` | text pasted on Submit | `pattern.txt` | optional |
| `photos` | photos uploaded on Submit | `transcript.txt`, Gemini's reading of the photos (`record.py transcribe`) | optional |

`url` and `photos` cases depend on the outside world, so a normal run uses
the saved snapshot/transcript, which keeps it fast and repeatable. Live
mode (`REGRESSION_LIVE=1`) re-fetches the page or re-reads the photos
(needs `GEMINI_API_KEY`) and checks the same expectations. If live fails
but the normal run passes, the site or the model changed, not our code.
Re-capture the input, then see whether the normal run still passes.

A different file name: `"input": "saved-page.html"` (or a list of text
files to join). Photos: every image in the folder in file-name order, or
list them with `"photos": ["front.jpg", "back.jpg"]`.

### `case.json`

```json
{
  "description": "Drops Air raglan -- materials table, two-column abbreviations",
  "kind": "url",
  "source_url": "https://www.example.com/patterns/raglan",
  "notes": "free text, ignored by the tests",
  "xfail": "optional: a known parser gap, see below",
  "expect": { ... }
}
```

### `expect`: only list what matters

Any of `title`, `author`, `materials`, `abbreviations`, `instructions`,
`source_site_name`, `source_domain`, `photo_url`. Fields you leave out
aren't checked. Whitespace differences never matter, and `contains`
checks ignore case.

Text fields (everything except `instructions`):

| write | means |
|---|---|
| `"title": "Cozy Beanie"` | exactly this (`null` for "must be empty/none") |
| `{"contains": ["5mm", "Drops Air"]}` | includes each of these |
| `{"not_contains": "Pin it for later"}` | includes none of these |
| `{"lines": ["- yarn", "- 5mm needles"]}` | exactly these lines, in order (blank lines ignored) |
| `{"present": true}` | not empty (`false`: must be empty) |
| `{"matches": "^k\\d"}` | regular expression found |

`instructions`, which is parts, each with steps:

| write | means |
|---|---|
| `{"Brim": ["Cast on 88.", "..."], "Body": [...]}` | exactly these parts, in order, with exactly these steps |
| `{"parts": ["Brim", "Body"]}` | exactly these part names, in order |
| `{"not_parts": ["Related posts"]}` | none of these parts |
| `{"steps": {"Brim": ["Cast on 88.", "..."]}}` | these parts have exactly these steps (other parts unchecked) |
| `{"step_count": {"Brim": 4}}` | how many steps a part has |
| `{"step_contains": {"Body": ["decrease", "6 inches"]}}` | some step in the part mentions each of these |
| `{"present": true}` | at least one part |

Checks can be combined in one object, e.g.
`{"parts": [...], "step_count": {...}}`. A typo in a field or check name
fails the run instead of being silently ignored.

### Known gaps: `xfail`

A pattern the parser can't handle yet still makes a good case. Write the
`expect` for what *should* happen and add `"xfail": "why it fails today"`.
The run stays green while it fails. Once a fix makes it pass, the run goes
red ("XPASS"), which is the cue to delete `xfail` so the case guards the
fix from then on.

## Adding a case

```bash
cd backend
P=.venv/bin/python; R=tests/regression/record.py

$P $R new drops-raglan-url --kind url --url https://... --description "..."
$P $R snapshot drops-raglan-url      # url: saves today's page as page.html
#   html/pdf/text: copy the file into the folder instead (page.html / pattern.pdf / pattern.txt)
#   photos: copy the photos in, then: $P $R transcribe <case-id>
$P $R show drops-raglan-url --draft  # prints what the parser gets today, saves expect.draft.json
```

Then write `expect` in `case.json`. `expect.draft.json` is today's
output, bugs included, so copy only the parts that are right and fix the
rest. Delete the draft file when you're done, and run the tests.
