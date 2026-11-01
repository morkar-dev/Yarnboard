# Yarnboard is one deployable unit (a single combined Render service --
# see render.yaml) but two separate toolchains during development (Python
# backend, Node frontend), so targets here are organized by toolchain
# rather than by "service": `test-backend`/`test-frontend` can be run and
# reasoned about independently, `test`/`install` just call both.
#
# Assumes the backend venv already exists at backend/.venv (see README's
# Local setup) -- run `make install` first on a fresh checkout.

.PHONY: install install-backend install-frontend \
        dev dev-backend dev-frontend down \
        test test-backend test-frontend \
        build build-check \
        e2e audit audit-main audit-dev audit-local

install: install-backend install-frontend

install-backend:
	cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt -r requirements-dev.txt

install-frontend:
	cd frontend && npm install

# Runs both dev servers concurrently (they're foreground processes, so
# `dev-backend && dev-frontend` would just block forever on the first one
# and never start the second). The trap ensures Ctrl+C kills both instead
# of leaving the backend running orphaned in the background.
dev:
	@trap 'kill 0' EXIT INT TERM; \
	$(MAKE) dev-backend & \
	$(MAKE) dev-frontend & \
	wait

dev-backend:
	cd backend && .venv/bin/flask --app wsgi run --port 5001

dev-frontend:
	cd frontend && npm run dev

# `dev`'s Ctrl+C trap only fires for the shell that ran it in the
# foreground -- a `make dev` backgrounded/detached (or a terminal closed
# out from under it) leaves the Flask and Vite processes running with
# nothing left to catch the signal. Kill by port rather than by process
# name (`flask`/`node`) so this can't take out an unrelated process that
# happens to share those names; 5001/5173 are hardcoded to this app's dev
# servers (see dev-backend above and frontend/vite.config.ts).
down:
	@echo "Stopping Yarnboard dev servers (ports 5001, 5173)..."
	@-lsof -ti :5001 -ti :5173 | xargs kill 2>/dev/null
	@echo "Done."

test: test-backend test-frontend

test-backend:
	cd backend && .venv/bin/pytest

test-frontend:
	cd frontend && npm run test

# Mirrors render.yaml's buildCommand exactly, so a broken production build
# can be caught locally before pushing -- see that file if the two ever
# drift, they should always match.
build: build-check

build-check:
	cd backend && pip install -r requirements.txt && cd ../frontend && npm install && npm run build

# Playwright e2e suite (frontend/e2e/). Runs against a throwaway SQLite
# file (backend/instance/e2e.db) that's always wiped and reseeded first,
# so this never touches the real local dev DB -- and against real dev
# servers on the normal 5001/5173 ports, so don't run this at the same
# time as `make dev`. RATELIMIT_ENABLED is deliberately left at its
# default (on) -- e2e/z-rate-limit.spec.ts needs it. RESEND_*/GEMINI_API_KEY
# are explicitly blanked, not just left unset -- wsgi.py's load_dotenv()
# would otherwise pull real keys from backend/.env (python-dotenv never
# overrides a var already present in the environment, even an empty one),
# which would make notifications.spec.ts's "no email attempt" assertion
# depend on real Resend delivery instead of the deterministic log
# fallback in backend/app/email.py. backend.log is what that spec reads
# to confirm a disabled email channel really didn't attempt a send.
e2e:
	@rm -f backend/instance/e2e.db backend.log frontend.log
	@cd backend && DATABASE_URL=sqlite:///e2e.db FLASK_ENV=development \
	    RESEND_ONBOARDING= RESEND_NOTIFICATIONS= RESEND_NEWSLETTER= GEMINI_API_KEY= \
	    .venv/bin/flask --app wsgi seed-e2e
	@trap 'kill 0' EXIT INT TERM; \
	( cd backend && DATABASE_URL=sqlite:///e2e.db FLASK_ENV=development CORS_ORIGINS=http://localhost:5173 \
	    RESEND_ONBOARDING= RESEND_NOTIFICATIONS= RESEND_NEWSLETTER= GEMINI_API_KEY= \
	    .venv/bin/flask --app wsgi run --port 5001 > ../backend.log 2>&1 & ) ; \
	( cd frontend && VITE_API_BASE_URL=http://localhost:5001 npm run dev > ../frontend.log 2>&1 & ) ; \
	echo "Waiting for backend/frontend..."; \
	for i in $$(seq 1 30); do curl -sf http://localhost:5001/api/health > /dev/null && break; sleep 1; done; \
	for i in $$(seq 1 30); do curl -sf http://localhost:5173/ > /dev/null && break; sleep 1; done; \
	cd frontend && npm run test:e2e; \
	status=$$?; \
	lsof -ti :5001 -ti :5173 | xargs kill 2>/dev/null; \
	exit $$status

# Re-checks the fixable findings from the speed & SEO audit (PageSpeed
# Insights / GTmetrix / SEOptimer): meta tags, robots.txt, sitemap.xml,
# llms.txt, ai-catalog.json, cache and security headers, the HTTPS
# redirect, SPF/DMARC, console errors, and Lighthouse's CLS (layout shift).
# Prints PASS/FAIL per item plus what still needs a human; fails if any
# check fails. HTTP checks are scripts/audit/seo_audit.py (stdlib only),
# browser checks frontend/scripts/audit-browser.mjs (Playwright's Chromium
# + Lighthouse via npx). AUDIT_SKIP_LIGHTHOUSE=1 skips the ~30s Lighthouse
# run.
#
# AUDIT_ENV picks the deployment, matching the two Cloudflare Workers in
# wrangler.jsonc: main -> the prod custom domain, dev -> the dev Worker's
# workers.dev URL (same default as e2e-dev/fixtures.ts). On dev the
# HTTPS-redirect and SPF/DMARC checks are skipped -- workers.dev is
# Cloudflare's domain, not ours to configure. (Not plain ENV: shells use
# that name for their own startup file.)
#
#   make audit-main               # the live site (also plain `make audit`)
#   make audit-dev                # the dev Worker
#   make audit AUDIT_URL=https://...  # any other URL (checked like main)
#   make audit-local              # this checkout, built and served locally
AUDIT_ENV ?= main
AUDIT_MAIN_URL ?= https://www.yarnboard.net
AUDIT_DEV_URL ?= https://yarnboard-dev.morkar9696.workers.dev
AUDIT_LOCAL_PORT ?= 8790

audit:
	@case "$(AUDIT_ENV)" in main|dev) ;; *) echo "AUDIT_ENV must be main or dev, got '$(AUDIT_ENV)'"; exit 2;; esac
	@url="$(AUDIT_URL)"; \
	[ -n "$$url" ] || { [ "$(AUDIT_ENV)" = dev ] && url="$(AUDIT_DEV_URL)" || url="$(AUDIT_MAIN_URL)"; }; \
	echo "Auditing $(AUDIT_ENV): $$url"; \
	status=0; \
	python3 scripts/audit/seo_audit.py "$$url" --env=$(AUDIT_ENV) || status=1; \
	( cd frontend && node scripts/audit-browser.mjs "$$url" ) || status=1; \
	exit $$status

audit-main:
	@$(MAKE) --no-print-directory audit AUDIT_ENV=main

audit-dev:
	@$(MAKE) --no-print-directory audit AUDIT_ENV=dev

# Builds the frontend exactly as Cloudflare does and serves it with
# `wrangler dev` -- so _headers and the SPA fallback behave like
# production -- plus a throwaway backend (its own SQLite file, wiped before
# and after; never the real yarnboard.db) so the pages render for real.
# Both run on their own ports, so this never collides with `make dev`.
AUDIT_LOCAL_API_PORT ?= 5003

audit-local:
	@cd frontend && VITE_API_BASE_URL=http://localhost:$(AUDIT_LOCAL_API_PORT) npm run build > /dev/null
	@rm -f backend/instance/audit.db
	@cd backend && DATABASE_URL=sqlite:///audit.db FLASK_ENV=development .venv/bin/flask --app wsgi seed-e2e > /dev/null 2>&1
	@trap 'lsof -ti :$(AUDIT_LOCAL_PORT) -ti :$(AUDIT_LOCAL_API_PORT) | xargs kill 2>/dev/null; rm -f backend/instance/audit.db' EXIT INT TERM; \
	( cd backend && DATABASE_URL=sqlite:///audit.db FLASK_ENV=development CORS_ORIGINS=http://localhost:$(AUDIT_LOCAL_PORT) \
	    RESEND_ONBOARDING= RESEND_NOTIFICATIONS= RESEND_NEWSLETTER= GEMINI_API_KEY= \
	    .venv/bin/flask --app wsgi run --port $(AUDIT_LOCAL_API_PORT) > /dev/null 2>&1 & ) ; \
	( npx -y wrangler@4 dev --port $(AUDIT_LOCAL_PORT) > /dev/null 2>&1 & ) ; \
	for i in $$(seq 1 60); do curl -sf http://localhost:$(AUDIT_LOCAL_API_PORT)/api/health > /dev/null && break; sleep 1; done; \
	for i in $$(seq 1 60); do curl -sf http://localhost:$(AUDIT_LOCAL_PORT)/ > /dev/null && break; sleep 1; done; \
	status=0; \
	python3 scripts/audit/seo_audit.py http://localhost:$(AUDIT_LOCAL_PORT) --local || status=1; \
	( cd frontend && node scripts/audit-browser.mjs http://localhost:$(AUDIT_LOCAL_PORT) ) || status=1; \
	exit $$status
