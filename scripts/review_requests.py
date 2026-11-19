#!/usr/bin/env python3
"""
List open pull requests in morkar-dev/Yarnboard on GitHub that haven't been
reviewed at their current commit. Used by the hourly "PR reviews"
scheduled task.

  python3 scripts/review_requests.py               # JSON list of PRs to review
  python3 scripts/review_requests.py --mark N SHA  # record PR N reviewed at SHA

Every open, non-draft PR counts: on a one-person repo nobody can be asked
to review their own PR, so waiting for a review request would never fire.
A PR comes back again when it gets new commits.

Uses the GitHub CLI (`gh`), already logged in on this Mac, so no token is
handled here. State (which commit of each PR was reviewed) lives in
~/.config/yarnboard/github-review-state.json.
"""

import json
import subprocess
import sys
from pathlib import Path

REPO = "morkar-dev/Yarnboard"
STATE_FILE = Path.home() / ".config" / "yarnboard" / "github-review-state.json"


def fail(message: str) -> None:
    print(json.dumps({"error": message}))
    sys.exit(1)


def load_state() -> dict:
    try:
        return json.loads(STATE_FILE.read_text())
    except (FileNotFoundError, ValueError):
        return {}


def open_pull_requests() -> list[dict]:
    try:
        result = subprocess.run(
            [
                "gh", "pr", "list", "-R", REPO, "--state", "open", "--limit", "100",
                "--json", "number,title,url,author,headRefName,baseRefName,headRefOid,isDraft",
            ],
            capture_output=True, text=True, timeout=60,
        )
    except FileNotFoundError:
        fail("The GitHub CLI (gh) isn't installed.")
    except subprocess.TimeoutExpired:
        fail("GitHub didn't answer within 60 seconds.")
    if result.returncode != 0:
        fail(f"gh pr list failed: {result.stderr.strip()[:300]} (run `gh auth status`)")
    return json.loads(result.stdout)


def main() -> None:
    if len(sys.argv) == 4 and sys.argv[1] == "--mark":
        state = load_state()
        state[sys.argv[2]] = sys.argv[3]
        STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        STATE_FILE.write_text(json.dumps(state, indent=2))
        print(json.dumps({"marked": sys.argv[2], "sha": sys.argv[3]}))
        return

    state = load_state()
    pending = [
        {
            "number": pr["number"],
            "title": pr["title"],
            "url": pr["url"],
            "author": pr["author"]["login"],
            "head_branch": pr["headRefName"],
            "base_branch": pr["baseRefName"],
            "sha": pr["headRefOid"],
            "draft": pr["isDraft"],
            "re_review": str(pr["number"]) in state,
        }
        for pr in open_pull_requests()
        if state.get(str(pr["number"])) != pr["headRefOid"]
    ]
    print(json.dumps({"repo": REPO, "pending": pending}, indent=2))


if __name__ == "__main__":
    main()
