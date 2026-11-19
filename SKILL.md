---
name: stfu
description: >
  Answers a short question straight from the conversation context, with zero tool calls. Stops the agent from re-running grep, git log, git show, git status, cat, ssh, SQL or MCP queries to "double check" things it already did, read or saw earlier in the session.
  TRIGGER when: the user's message is a short question, one or two lines and usually ending in "?", about something already in context: a change you made, a file you read, command output you saw, a plan you proposed, or general knowledge. Typical shapes: "pushed?", "no FE changes right?", "it's not staged correct?", "so viewer was able to edit?", "is this the correct fix?", "should I run it now?", "so it involves backend work?", "how exactly does this feature work?", "tldr what was the gap?".
  TRIGGER when: the user says "answer the question", "just answer", "stfu", "tldr", "stop checking", "you already know", "you already grepped", or interrupts a tool call and repeats the question.
  DO NOT TRIGGER when: the user asks you to do, fix, build, run, check, verify or look something up, or the question is about something nobody in this session has looked at yet and the user wants you to find out.
---

# STFU

The user asked a question. Answer it from what you already know. No tools.

## The rule

Zero tool calls before the answer. No Bash, Grep, Glob, Read, `git log`, `git show`, `git diff`, `git status`, `gh`, `ssh`, SQL, MCP queries, subagents or browser. Not "one quick check" either. In the sessions this skill came from, most interrupts landed after a single grep.

You already have the answer in context: the diff you wrote, the files you read, the command output, the plan you laid out. Re-reading it "to verify against the code rather than my memory" is the exact behavior this skill bans. The user saw you do the work. They want the answer, not a re-audit.

## How to answer

1. The first word answers: yes, no, a number, a file, a name.
2. Add at most two sentences of why, and only if the answer is not obvious.
3. No headers, bullets, tables, bold labels or recap of the session.
4. No suggestions, next steps or product ideas nobody asked for.
5. Stop.

## When you don't know

Say so in one line, name the single check that would settle it, and wait.

> Not sure. I didn't touch the FE this session, but `git status` in front-end would confirm. Want me to run it?

Do not run it until the user says yes.

For live systems (queues, servers, deploys), answer with the last thing you saw and when you saw it:

> As of the 13:20 query, yes. I haven't checked since.

## Banned openers

These sentences mean you are about to break the rule. Delete them and answer instead.

- "Let me verify that against the code..."
- "Let me check..." / "Let me confirm..." / "Let me look at..."
- "Checking X before answering."
- "Good question."

## Real examples

| Question | What the agent did | What it should have said |
| --- | --- | --- |
| "no FE changes right?" | `grep -rn thumbnailTimestampMs front-end` | "Right, the change is backend only." |
| "pushed?" | `git fetch` then `git log` | "Yes, pushed to `worktree-mobile-ui`." or "No, committed but not pushed." |
| "so viewer was able to edit?" | `git show HEAD:.../api-token.service.ts` | "Yes" or "No", from the fix you just wrote. |
| "is this a correct fix?" | "Let me verify that against the original code rather than my memory of it." | "Yes" or "No, because ..." |
| "should I run it now?" | `ssh` to the VPS, `docker ps` | "Yes." or "Wait until the deploy finishes." |
| "so it involves backend work?" | two greps over `apps/auth` | "Yes" or "No", and which service, from the plan you just gave. |
| "it's not staged on FE correct?" | `git diff --cached --name-only` | "Correct, nothing staged on FE." |

## If you get interrupted

An interrupted tool call followed by the same question, in caps or with swearing, means you already broke the rule. Answer right away. No tool call, no apology paragraph, no "you're right".

## When tools come back

The ban covers that one answer. If the user replies "check it", "verify", "run it" or asks for a change, use tools as normal.
