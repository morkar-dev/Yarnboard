import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Smoke tests against a *deployed* site (dev or prod), run by GitHub Actions
 * (see .github/workflows/smoke.yml) or by hand. Unlike frontend/e2e-dev/,
 * this needs no database access: it logs into one long-lived test
 * account whose login comes from CI variables, and only ever creates a
 * single reusable private pattern in it.
 *
 * Everything goes through the site's own URL, so /api requests pass
 * through the Cloudflare Worker exactly as a real visitor's do.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));

try {
  // Optional local overrides for running by hand; never committed (see
  // the root .gitignore).
  process.loadEnvFile(path.join(__dirname, ".env"));
} catch {
  // No .env -- use the environment as-is (the CI case).
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. In GitHub: Settings > Secrets and variables > Actions. ` +
        `By hand: put it in frontend/e2e-smoke/.env.`,
    );
  }
  return value;
}

export const SMOKE_BASE_URL = () => required("SMOKE_BASE_URL").replace(/\/+$/, "");
export const SMOKE_EMAIL = () => required("SMOKE_EMAIL");
export const SMOKE_PASSWORD = () => required("SMOKE_PASSWORD");

/** Health flags that must be true for the run to pass. The rest are
 * still printed, just not enforced (dev may deliberately send no email). */
export const REQUIRED_FLAGS = (process.env.SMOKE_REQUIRE ?? "gemini,proxy_secret,proxy_verified")
  .split(",")
  .map((flag) => flag.trim())
  .filter(Boolean);

export const AUTH_FILE = path.join(__dirname, ".auth", "smoke-user.json");
export const STATE_FILE = path.join(__dirname, ".state.json");
export const PHOTO_FILE = path.join(__dirname, "pattern-photo.jpg");

export const SMOKE_PATTERN_TITLE = "Smoke test pattern (automated, safe to ignore)";
