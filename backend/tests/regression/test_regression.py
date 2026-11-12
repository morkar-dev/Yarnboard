"""
Real-world parser regression cases -- one test per folder in cases/.
See README.md in this folder for the case format and how to add one.

    pytest tests/regression                    # offline: saved inputs only
    REGRESSION_LIVE=1 pytest tests/regression  # also re-fetch live pages / re-read photos

When a case fails, what the parser actually produced is written next to
it as actual.json (git-ignored), to compare with case.json's "expect".
"""
import json
import os

import pytest

from harness import CaseError, LIVE_KINDS, all_cases, check, load_case, parse

LIVE = os.environ.get("REGRESSION_LIVE") == "1"
CASE_DIRS = all_cases()


def _load(case_dir):
    try:
        return load_case(case_dir)
    except CaseError as exc:
        error = str(exc)
    pytest.fail(error, pytrace=False)  # outside the except: no chained traceback


def _parse(case, *, live=False):
    try:
        return parse(case, live=live)
    except CaseError as exc:
        error = str(exc)
    pytest.fail(error, pytrace=False)


def _verify(case, draft, *, label=""):
    actual_path = case.dir / f"actual{label}.json"
    problems = check(draft, case.expect)
    if problems:
        actual_path.write_text(json.dumps(draft, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        report = "\n".join(f"  - {p}" for p in problems)
        pytest.fail(
            f"{case.id}{label}: {len(problems)} mismatch(es) -- {case.description}\n{report}\n"
            f"  (full parser output: {actual_path.relative_to(case.dir.parent.parent)})",
            pytrace=False,
        )
    actual_path.unlink(missing_ok=True)


def _expect_or_skip(case):
    if case.expect is None:
        pytest.skip(f"{case.id}: no \"expect\" in case.json yet")


@pytest.mark.parametrize("case_dir", CASE_DIRS, ids=[d.name for d in CASE_DIRS])
def test_case(case_dir, request):
    case = _load(case_dir)
    _expect_or_skip(case)
    if case.xfail:
        # A known parser gap. Strict: once the parser is fixed this case
        # "unexpectedly passes" and fails the run -- the cue to delete
        # "xfail" from case.json and keep the case as a guard.
        request.applymarker(pytest.mark.xfail(reason=case.xfail, strict=True))
    draft = _parse(case)
    _verify(case, draft)


def _live_dirs():
    dirs = []
    for d in CASE_DIRS:
        try:
            if load_case(d).kind in LIVE_KINDS:
                dirs.append(d)
        except CaseError:
            pass  # reported by test_case
    return dirs


@pytest.mark.live
@pytest.mark.skipif(not LIVE, reason="set REGRESSION_LIVE=1 to re-fetch live pages / re-read photos")
@pytest.mark.parametrize("case_dir", _live_dirs(), ids=[d.name for d in _live_dirs()])
def test_case_live(case_dir, request):
    """Same expectations, against today's live page (url) or a fresh Gemini
    reading (photos). A failure here with test_case passing means the
    site or the model changed, not our parser -- re-capture the input
    with record.py, then see whether test_case still passes."""
    case = _load(case_dir)
    _expect_or_skip(case)
    if case.xfail:
        request.applymarker(pytest.mark.xfail(reason=case.xfail, strict=False))
    draft = _parse(case, live=True)
    _verify(case, draft, label=".live")


def test_every_case_json_is_valid():
    """Catches a typo'd field or check name in any case.json up front,
    rather than as a confusing pass (an unknown key would otherwise just
    be ignored)."""
    errors = []
    for d in CASE_DIRS:
        try:
            load_case(d)
        except CaseError as exc:
            errors.append(str(exc))
    assert not errors, "\n".join(errors)
