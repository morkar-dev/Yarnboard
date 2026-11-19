#!/usr/bin/env python3
"""
List open GitLab merge requests in morkar-group/yarnboard where you are a
requested reviewer and that you haven't had reviewed at their current
commit. Used by the "MR review requests" scheduled task.

  python3 scripts/review_requests.py            # JSON list of MRs to review
  python3 scripts/review_requests.py --mark IID SHA   # record a review as done

Token: a GitLab personal access token with the read_api scope, in
~/.config/yarnboard/gitlab-token (only the token, chmod 600), or in the
file named by YARNBOARD_GITLAB_TOKEN_FILE. It is never printed. State (which MR commits were already reviewed) lives in
~/.config/yarnboard/review-state.json.
"""

import json
import os
import sys
import urllib.parse
import urllib.request
from pathlib import Path

PROJECT = "morkar-group/yarnboard"
API = "https://gitlab.com/api/v4"
CONFIG = Path.home() / ".config" / "yarnboard"
TOKEN_FILE = Path(os.environ.get("YARNBOARD_GITLAB_TOKEN_FILE") or CONFIG / "gitlab-token").expanduser()
STATE_FILE = CONFIG / "review-state.json"


def fail(message: str) -> None:
    print(json.dumps({"error": message}))
    sys.exit(1)


def token() -> str:
    if not TOKEN_FILE.exists():
        fail(f"No token: create {TOKEN_FILE} with a read_api GitLab token.")
    value = TOKEN_FILE.read_text().strip()
    if not value:
        fail(f"{TOKEN_FILE} is empty.")
    return value


def get(path: str, params: dict | None = None):
    url = f"{API}{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    request = urllib.request.Request(url, headers={"PRIVATE-TOKEN": token()})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        fail(f"GitLab API {exc.code} for {path}")
    except urllib.error.URLError as exc:
        fail(f"Can't reach GitLab: {exc.reason}")


def load_state() -> dict:
    try:
        return json.loads(STATE_FILE.read_text())
    except (FileNotFoundError, ValueError):
        return {}


def main() -> None:
    if len(sys.argv) == 4 and sys.argv[1] == "--mark":
        state = load_state()
        state[sys.argv[2]] = sys.argv[3]
        CONFIG.mkdir(parents=True, exist_ok=True)
        STATE_FILE.write_text(json.dumps(state, indent=2))
        print(json.dumps({"marked": sys.argv[2], "sha": sys.argv[3]}))
        return

    me = get("/user")["username"]
    project = urllib.parse.quote(PROJECT, safe="")
    mrs = get(
        f"/projects/{project}/merge_requests",
        {"state": "opened", "reviewer_username": me, "per_page": 100},
    )
    state = load_state()
    pending = [
        {
            "iid": mr["iid"],
            "title": mr["title"],
            "url": mr["web_url"],
            "author": mr["author"]["username"],
            "source_branch": mr["source_branch"],
            "target_branch": mr["target_branch"],
            "sha": mr["sha"],
            "draft": mr.get("draft", False),
            "re_review": str(mr["iid"]) in state,
        }
        for mr in mrs
        if state.get(str(mr["iid"])) != mr["sha"]
    ]
    print(json.dumps({"reviewer": me, "pending": pending}, indent=2))


if __name__ == "__main__":
    main()
