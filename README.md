# Yarnboard

A dashboard for all the knitting and crochet instructions scattered across
different websites. Paste a link to a pattern page, and Yarnboard pulls out
the materials, abbreviations, and step-by-step instructions into a
checklist you can follow while you craft -- then saves it to a shared
community library (deduplicated by source URL) so nobody has to scrape the
same pattern twice.

Every pattern always shows **who uploaded it to Yarnboard** and **who
originally designed it** (with a link back to the source page), and
uploading always publishes to the whole community -- users are told this
clearly before they publish.

## Architecture

```
[Browser] --fetch(credentials:include)--> [Flask, single Render service]
                                                |         |
                                                |         v
                                                |    [built React/Vite files,
                                                |     served directly by Flask --
                                                |     see FRONTEND_DIST in app/__init__.py]
                                                v
                                          [Neon Postgres, via psycopg2]
```

Frontend and backend deploy as **one combined Render service**: the build
step installs the backend's Python deps and builds the React app, and
Flask itself serves the built frontend files alongside its `/api/*`
routes (see `serve_frontend` in `backend/app/__init__.py`). Locally they
still run as two separate dev processes (Vite on 5173, Flask on 5001) for
hot-reload -- see Local setup below.

- **Backend** (`backend/`): Flask, split into a small app-factory package
  (`app/`) with two blueprints -- `auth` (accounts, session cookies) and
  `patterns` (scrape-preview, publish, the three pattern list views,
  per-user checklist progress). See `backend/app/*.py` module docstrings
  for what each file is responsible for.
- **Scraper** (`backend/app/scraper.py`): best-effort heuristic extraction
  (a headless browser via Playwright, parsed with BeautifulSoup) based on
  heading keywords (English and Hebrew) and list markup. There's no
  universal format for pattern pages across the web, so the scraper's
  output is always shown to the user as an **editable draft** before
  anything is saved -- never assume it's 100% correct. Outbound fetches
  are restricted to public `http(s)` hosts (no `file://`, no
  loopback/private/link-local addresses, checked both up front and
  per-request) so a submitted URL can't be used to read local files off
  the server or reach internal services (SSRF).
- **Text & photo patterns**: a pattern can also be pasted as plain text
  (`parse_pattern_text` in `scraper.py`: first line is the title,
  `Heading:` / `# Heading` lines start sections and parts) or
  photographed -- up to 5 photos, shrunk in the browser, then transcribed
  by Gemini (`backend/app/transcription.py`, same `GEMINI_API_KEY`) into
  that same text format. Both land on the usual review draft. The source
  link is optional for these; without one the pattern is stored with a
  `manual:<uuid>` placeholder URL and `has_source_link: false`.
- **Translation & RTL**: a pattern can be machine-translated in either
  direction -- an English-primary pattern gets a Hebrew overlay, or a
  Hebrew-primary one gets an English overlay -- via the Gemini API
  (`backend/app/translation.py`, requires `GEMINI_API_KEY`). When the
  main model (`gemini-flash-latest`) is overloaded, rate-limited or too
  slow, the same request is retried on `gemini-flash-lite-latest`; set
  `GEMINI_MODEL` / `GEMINI_FALLBACK_MODEL` on a service to change either
  without a code change. A translation is reviewable/correctable on the pattern's Edit page and
  marked reviewed once a person touches it. Content fields throughout the
  app use `dir="auto"` so right-to-left text displays correctly
  regardless of which language the UI chrome itself is in.
- **Per-user checklist progress**: a pattern's instructions are shared by
  everyone (one row in the `pattern` table), but checking off a step is
  personal -- tracked in a separate `user_pattern_progress` table so one
  person's progress never shows up as completed for anyone else viewing
  the same community pattern.
- **Editing & permissions**: a pattern's uploader, or a user with
  `is_admin` set (granted via `flask make-admin <email>`, see Local setup),
  can edit its title/author/materials/abbreviations/instructions after
  publishing. Editing `instructions` bumps `Pattern.instructions_version`,
  which invalidates other users' checklist progress on it -- lazily, per
  user, not as a bulk reset (see `UserPatternProgress.pattern_version`'s
  docstring in `backend/app/models.py` for the full mechanism). Affected
  users see an in-app banner (polled, `frontend/src/components/
  UpdateBanner.tsx`) and get an email (`backend/app/email.py`, via Resend)
  the next time a pattern they've engaged with changes.
- **Frontend** (`frontend/`): Vite + React + TypeScript, React Router,
  a typed API client (`src/api/client.ts`), and a single `AuthContext` for
  the logged-in user. No larger state library -- the app is small enough
  that page-local `useState` plus one context is sufficient.
- **Auth**: server-side session cookies (Flask's signed session) plus
  bcrypt password hashing. Since frontend and backend are one combined
  service in production, they're always same-origin -- an ordinary `Lax`
  session cookie (just `Secure`, since prod is HTTPS) is enough, no
  cross-site cookie workaround needed (see `backend/app/config.py`). CORS
  is still enabled for local dev, where Vite and Flask really are
  separate origins.
- **Security**: login, register, and resend-verification are rate
  limited per IP (Flask-Limiter); the app refuses to start in production
  if `SECRET_KEY` is left at its insecure default; passwords must be at
  least 8 characters; and user-controlled text (username, pattern title)
  is HTML-escaped before being interpolated into outbound emails. See
  `backend/tests/test_security.py` (run in CI, see `.gitlab-ci.yml`)
  for the regression tests of all this, plus the CI's dependency
  vulnerability scanning (`pip-audit`,
  `npm audit`).

## Local setup

### Backend

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # leave DATABASE_URL unset to use local SQLite,
                             # and the RESEND_* keys unset to log emails
                             # instead of sending them
flask --app wsgi init-db    # creates the tables
flask --app wsgi make-admin you@example.com  # optional: grant edit-any-pattern rights
flask --app wsgi run --port 5001
```

### Frontend

```bash
cd frontend
npm install
cp .env.example .env.local  # points at the local backend by default
npm run dev                 # http://localhost:5173
```

Register an account, then use "Submit a Pattern" to try it against a real
pattern page. The scraper is heuristic -- if a page doesn't extract
cleanly, the review screen lets you fill in materials/abbreviations/steps
by hand before publishing.

## Running the e2e tests

```bash
make e2e
```

One command runs the whole thing: wipes and reseeds a throwaway
`backend/instance/e2e.db` (see `flask --app wsgi seed-e2e` in
`backend/app/__init__.py` for exactly what it creates -- four fixture
users and eight patterns covering permissions, sharing, and translation
scenarios), starts real backend/frontend dev servers on the normal
5001/5173 ports, runs the Playwright suite (`frontend/e2e/`) against
them, then tears everything down. It never touches your real local
`backend/instance/yarnboard.db`, but it does use the same ports as
`make dev` -- don't run both at once. Real Resend/Gemini calls are
disabled for the run (see the Makefile), so email sends and translations
are asserted against the app's own log-fallback/seeded-data behavior,
not live third-party delivery -- that stays part of manual pre-merge QA.

This repo also has Playwright's AI test agents set up
(`npx playwright init-agents --loop=claude`, see `.claude/agents/
playwright-test-*.md` and `frontend/.mcp.json`) for drafting/maintaining
specs against a live running app from inside Claude Code -- the planner
explores the app and writes a plan, the generator turns it into real
spec files verified against the live DOM, and the healer can patch a
spec whose selector broke after a UI change. All three need the
`playwright-test` MCP server connected (Claude Code will prompt to
enable it once `frontend/.mcp.json` is picked up); every generated or
healed change should still be reviewed like any other diff before it's
trusted.

### Running the e2e suite against the deployed dev environment

```bash
cp frontend/e2e-dev/.env.example frontend/e2e-dev/.env
# edit frontend/e2e-dev/.env, filling in E2E_REMOTE_DATABASE_URL
npm --prefix frontend run test:e2e:dev
```

`frontend/e2e-dev/.env` is loaded automatically (see `fixtures.ts`) and is
already covered by the repo's root `.gitignore` -- never commit it. An
`export`ed shell variable of the same name still works too, if you'd
rather not use a file.

A separate suite (`frontend/e2e-dev/`, `playwright.dev.config.ts`) that
exercises the real deployed dev environment (the Cloudflare-hosted
frontend + the `yarnboard-dev-api` Render backend) instead of local dev
servers -- for spot-checking an actual deployment, not a substitute for
`make e2e` above. Every run records video (`video: "on"`), so a
spot-check leaves behind something to watch afterward, in
`frontend/test-results/`.

Since the dev database is a real, never-wiped database (not a
disposable local file), this suite creates its fixtures non-destructively
through the real API in `global-setup.ts` -- registering a few
uniquely-suffixed users and one shared pattern per run, exactly as a real
user would, rather than reusing `seed-e2e`'s `drop_all()`. Verifying a
fixture user's email still needs the same `e2e-verify-token` CLI command
as the local suite, just pointed at the remote database via
`E2E_REMOTE_DATABASE_URL` instead of the local SQLite file -- export that
in your own shell only, never commit it.

Not run in CI, and deliberately doesn't check real email delivery -- see
`frontend/e2e-dev/notifications.spec.ts`'s docstring for why.

## Storybook: component, accessibility and visual tests

Every component (and the pattern detail, submit and edit pages) has
stories in `frontend/src/**/*.stories.tsx` -- each one a fixed UI state
(guest vs logged in, empty, error, loading, Hebrew/RTL, phone width). They
run against a fake API (MSW, `frontend/src/mocks/`), never the backend.

```bash
npm --prefix frontend run storybook        # browse them at localhost:6006
npm --prefix frontend run test:stories     # interaction tests + axe a11y scan
```

`test:stories` renders every story in headless Chromium, runs its `play`
function (clicks, typing, assertions), then fails on any accessibility
violation. Play functions find buttons and labels by their translated text
(`t("submit.modeText")` from `frontend/src/mocks/text.ts`), never by
hard-coded English, because the visual tests run every story in Hebrew too
and fail if a play function throws there. If a rule genuinely can't be fixed yet, switch it off on that
one story with a comment rather than globally.

Visual regression compares a screenshot of every story, in English and
Hebrew, with the PNGs in `frontend/visual/__screenshots__/<os>/`:

```bash
npm --prefix frontend run build-storybook
npm --prefix frontend run test:visual          # compare
npm --prefix frontend run test:visual:update   # accept an intended change
```

Baselines are per OS because fonts render differently: `darwin/` is for
local runs on a Mac, `linux/` is CI's. Locally, a story with no baseline
yet gets one written and passes (with a "new baseline" note); add
`-- --update-snapshots=none` for the strict mode, where a missing baseline
fails. Review and commit new/changed PNGs like any other diff (the report
lands in `frontend/visual-report/`).

CI is strict about Linux baselines: if a `frontend-stories` run had to
write any (a new story, or the very first run), the job fails and lists
them in `visual-new-baselines.txt`. Download that job's artifacts, review
the PNGs, and commit them under `frontend/visual/__screenshots__/linux/`;
the next run compares against them. That's also how to accept an
intended UI change on Linux: delete the affected PNGs and let CI write
fresh ones.

## CI (GitHub Actions)

The repository lives on GitHub (`morkar-dev/Yarnboard`); `.github/workflows/`
runs the checks, and results show on each pull request and in the
**Actions** tab (download a run's artifacts for test reports, screenshots
and logs). GitHub emails you when a run fails.

| When | What runs |
| --- | --- |
| Pull request, push to `main` | `ci.yml`: backend tests, frontend type check + unit tests, Storybook interaction/accessibility/screenshot tests, production build, e2e suite; `security.yml`: dependency audits |
| Push to `dev` / `main` | `smoke.yml`: smoke test of the dev / prod site, 10 minutes later (time to deploy) |
| Daily, 06:00 UTC | `smoke.yml`: both sites. `security.yml` also runs weekly |
| Actions tab > Smoke > Run workflow | `smoke.yml` for dev, prod or both |

`.gitlab-ci.yml` is the same pipeline for GitLab, kept from when the
repository was hosted there.

### Smoke tests against the deployed sites

`frontend/e2e-smoke/` checks a live site end to end, through the
Cloudflare Worker like a real visitor: `/api/health` settings, opening a
pattern logged in, pasting text, a real Gemini photo read and a real
Gemini translation. It waits out Render's free-tier wake-up first. Each
run creates one private pattern in the test account and deletes it at
the end.

`/api/health` reports which settings a deployment has, as true/false
only: `gemini`, `email_onboarding`, `email_notifications`, `proxy_secret`,
and `proxy_verified` (this request came through the Worker with a
matching `PROXY_SHARED_SECRET`). The smoke test fails if a required one
is false -- dev requires `gemini`, `proxy_secret`, `proxy_verified`; prod
also requires both email keys.

One-time setup:

1. On each site, register a normal (non-admin) account just for this,
   with its own strong password, and verify its email.
2. In GitHub: **Settings > Secrets and variables > Actions**, add
   - secrets `SMOKE_DEV_EMAIL`, `SMOKE_DEV_PASSWORD`, `SMOKE_PROD_EMAIL`,
     `SMOKE_PROD_PASSWORD`
   - the variable `SMOKE_PROD_URL` (the prod site's address), and
     optionally `SMOKE_DEV_URL`, if the dev site moves from
     `https://yarnboard-dev.morkar9696.workers.dev`

To run it by hand, put `SMOKE_BASE_URL`, `SMOKE_EMAIL` and
`SMOKE_PASSWORD` in `frontend/e2e-smoke/.env` (git-ignored) and run
`npm run test:smoke` in `frontend/`; the report is in
`frontend/smoke-results/html/`.

## Deploying to Render

Yarnboard deploys as a **single** Render web service (not separate
frontend/backend services) -- Flask serves the built React app itself.

1. Create a Postgres database at [neon.tech](https://neon.tech) and copy
   its connection string.
2. In the Render dashboard, create a new **Blueprint** from this repo --
   Render will read `render.yaml` and create one service (`yarnboard`)
   with the build/start commands already filled in:
   - Build: `cd backend && pip install -r requirements.txt && cd ../frontend && npm install && npm run build`
   - Start: `cd backend && gunicorn wsgi:app`

   (If you're configuring a Web Service manually instead of via Blueprint,
   enter those same two commands yourself -- there's no `rootDir` to set,
   since the build spans both `backend/` and `frontend/`.)
3. Set the env vars marked `sync: false` in `render.yaml`: `SECRET_KEY`
   (any long random string), `DATABASE_URL` (the Neon connection string
   from step 1), and `RESEND_ONBOARDING`/`RESEND_NOTIFICATIONS`/
   `RESEND_NEWSLETTER`/`RESEND_FROM_EMAIL` (from
   [resend.com](https://resend.com) -- one API key per email category,
   see `app/email.py`; a category's emails are just logged instead of
   sent if its key is left unset, and `RESEND_NEWSLETTER` isn't used by
   any sender yet). Update
   `PUBLIC_APP_URL` to match this service's actual Render URL (used to
   build links in emails). Don't set `VITE_API_BASE_URL` -- leaving it
   unset is what makes the built frontend call the API with relative,
   same-origin paths.
4. Run the schema against the Neon database once:
   `DATABASE_URL=<neon-connection-string> flask --app wsgi init-db`
   (run this locally, pointed at the production database, since there's no
   migration tool in v1 -- see Known limitations). If the database already
   existed before the pattern-editing feature (i.e. you're upgrading, not
   starting fresh), also run
   `DATABASE_URL=<neon-connection-string> flask --app wsgi add-versioning-columns`,
   since `init-db` only creates missing tables, never adds columns to
   ones that already exist. Same deal if the database predates the
   pattern-photo feature: also run
   `DATABASE_URL=<neon-connection-string> flask --app wsgi add-photo-columns`.
   Same deal again if it predates the Stitch Fiddle chart-import feature:
   also run
   `DATABASE_URL=<neon-connection-string> flask --app wsgi add-chart-grid-columns`.
   Same deal again if it predates email verification: also run
   `DATABASE_URL=<neon-connection-string> flask --app wsgi add-email-verification-columns`
   (this one backfills existing accounts as already-verified so nobody gets
   locked out retroactively -- see the command's docstring in
   `app/__init__.py`). Same deal again if it predates Hebrew translation:
   also run
   `DATABASE_URL=<neon-connection-string> flask --app wsgi add-hebrew-translation-columns`,
   and if it predates the reverse (Hebrew-primary -> English) translation
   direction, also run
   `DATABASE_URL=<neon-connection-string> flask --app wsgi add-english-translation-columns`.
   Same deal again if it predates private patterns/sharing: also run
   `DATABASE_URL=<neon-connection-string> flask --app wsgi add-pattern-visibility-columns`
   (this one also swaps a unique constraint, not just adding a column --
   see the command's docstring), and if it predates edit-level sharing and
   per-user notification settings, also run
   `DATABASE_URL=<neon-connection-string> flask --app wsgi add-sharing-and-notification-columns`.
5. Grant yourself edit-any-pattern rights once:
   `DATABASE_URL=<neon-connection-string> flask --app wsgi make-admin you@example.com`.

## Deploying the frontend to Cloudflare

An alternative to the combined Render deployment above: host the built
frontend as static assets on Cloudflare Workers (e.g. on your own
domain), while the API keeps running on Render as normal. The Worker
script in `worker/index.js` proxies `/api/*` through to Render, so the
browser still sees one origin: the page and the API are both on your
domain. That's required, not just tidy -- with the API called directly on
`*.onrender.com`, the session cookie is a third-party cookie, which
Safari (and every iOS browser) drops, so login appears to work and then
every call 401s.

Two stages, each with **its own Cloudflare project and its own Render
backend** -- the dev Worker proxies to a dev API built from `dev`, so
backend changes can be tried on the dev site before they reach prod:

|                    | **prod**                          | **dev**                                    |
| ------------------ | ---------------------------------- | ------------------------------------------- |
| Git branch         | `main`                             | `dev`                                       |
| Worker name         | `yarnboard` (`wrangler.jsonc`'s default/unnamed config) | `yarnboard-dev` (`wrangler.jsonc`'s `env.dev`) |
| Deploy command      | `npx wrangler deploy --env=""`     | `npx wrangler deploy --env dev`             |
| Served at           | your custom domain                 | the auto-generated `yarnboard-dev.<your-subdomain>.workers.dev` |
| `VITE_API_BASE_URL` | **unset** (relative `/api` via the proxy) | **unset**                           |
| Render backend (`API_ORIGIN`) | `yarnboard` -- `https://yarnboard.onrender.com`, from `main` (`wrangler.jsonc`'s top-level `vars`) | `yarnboard-dev-api` -- `https://yarnboard-dev-api.onrender.com`, from `dev` (`env.dev.vars`; branch previews use it too) |

A single project can't safely cover both: Cloudflare's git integration
deploys whatever branch triggers a build to the Worker name in
`wrangler.jsonc`, so without the separate `env.dev`/`--env dev` config
above, a `dev` push would silently overwrite the live prod Worker.

1. Deploy both backends to Render:
   - **Prod (`yarnboard`)**: the Blueprint in "Deploying to Render" above
     -- `render.yaml` defines only this one service.
   - **Dev (`yarnboard-dev-api`)**: create it by hand (not through the
     Blueprint, which would only create a second `yarnboard`). In the
     Render dashboard: **New -> Web Service**, pick this repo, then:
     - Name: `yarnboard-dev-api` (this sets its URL,
       `https://yarnboard-dev-api.onrender.com`)
     - Branch: `dev`, with Auto-Deploy **On Commit**
     - Runtime Python, and the same Build and Start commands as prod
       (step 2 of "Deploying to Render")
     - Environment: the same variables as prod (step 3 there), except
       `DATABASE_URL` -- point it at a separate database (e.g. a Neon
       branch) so dev data stays out of prod, and run `init-db` against
       it once (step 4) -- and `PUBLIC_APP_URL`, which should be the dev
       site (`https://yarnboard-dev.<your-subdomain>.workers.dev`) so
       email links open there.
2. Point `API_ORIGIN` in `wrangler.jsonc` at them: the default config at
   the prod service, `env.dev` and `previews` at the dev one.
   `CORS_ORIGINS` on Render isn't needed for this setup -- the proxy
   strips the `Origin` header, since the browser's request is same-origin.
   Then set `PROXY_SHARED_SECRET` (a long random string) on each Render
   service (Environment) and as a secret on the Worker in front of it --
   `npx wrangler secret put PROXY_SHARED_SECRET` for prod and
   `npx wrangler secret put PROXY_SHARED_SECRET --env dev` for dev. Each
   Worker's value must match its own backend's. It lets the
   backend trust the visitor IP the Worker forwards (see `client_ip()` in
   `backend/app/extensions.py`); without it, every visitor coming through
   the Worker shares one login/register rate-limit bucket.
3. In the Cloudflare dashboard, create **two** Workers projects
   connected to this repo -- one tracking `main`, one tracking `dev`.
   This repo's root `wrangler.jsonc` already defines both Worker configs
   (default = prod, `env.dev` = dev), and already points
   `assets.directory` at `frontend/dist` for both (Wrangler defaults to
   the raw, unbuilt `frontend` folder without it, which serves a blank
   page -- `index.html` references `/src/main.tsx`, a `.tsx` file
   browsers can't execute). What's *not* in a repo file, and needs
   setting per-project in Cloudflare's build settings (see the table
   above for the two values that actually differ):
   - **Build command**: none needed -- `wrangler.jsonc`'s `build.command`
     builds the frontend as part of every `wrangler deploy` / `wrangler
     preview`, so `frontend/dist` always exists at deploy time.
   - **Deploy command**: `npx wrangler deploy --env=""` for the prod
     project, `npx wrangler deploy --env dev` for the dev project (the
     explicit `--env` is required once `wrangler.jsonc` defines more than
     one environment -- Wrangler refuses to guess which one you meant).
   - **No** `VITE_API_BASE_URL` build variable (delete it if an older
     setup added one). Left unset, the built frontend calls relative
     `/api/...` paths (see `frontend/src/api/client.ts`), which the
     Worker proxies to Render. Set to the Render URL, it bypasses the
     proxy and brings back the Safari/iOS 401s.
4. Add your custom domain to the **prod** project only (Cloudflare
   dashboard -> Workers project -> Custom Domains). Leave the dev project
   on its `*.workers.dev` URL.

## Known limitations

- The scraper is heuristic and best-effort; it's designed to feed a human
  review step, not to be a guaranteed-correct parser for every pattern site.
- Editing a pattern invalidates progress pattern-wide, not per-part -- a
  typo fix in one step resets everyone's checklist on the whole pattern,
  not just that step. A deliberate trade-off for a simple, lazy
  invalidation mechanism (see `UserPatternProgress.pattern_version`)
  rather than a smart per-part merge.
- No optimistic locking on pattern edits -- last-write-wins if two people
  somehow edit the same pattern at once (only its uploader and admins can,
  so this is inherently rare).
- No migration tool (Alembic, etc.) -- schema setup is a one-off
  `flask init-db` command for new databases, plus a purely-additive
  `flask add-*-columns` command per feature for upgrading an existing one
  (see the full list in Deploying to Render above); appropriate for the
  app's current size and rate of schema change.
- Manually-uploaded pattern photos are stored as bytes directly in
  Postgres (re-encoded as JPEG, capped at 1600px/2MB raw upload) rather
  than a dedicated object store -- simplest option given Render's web
  service has no persistent disk, at the cost of DB size growing with
  photo count and no CDN in front of them.
- Rate limiting (Flask-Limiter) uses in-memory storage, its default --
  fine at this app's current single-service scale, but limits reset on
  every restart and wouldn't be shared across multiple worker processes
  if the deployment ever grows beyond one.
