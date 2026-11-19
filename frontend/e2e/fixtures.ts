import { request } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Shared constants for the fixtures `flask seed-e2e` creates (see
 * backend/app/__init__.py) -- kept in one place so a spec file never
 * hardcodes a username/title that's drifted from the seed script.
 */
export const USERS = {
  admin: { email: "admin@e2e.test", username: "e2e_admin", password: "password123" },
  alice: { email: "alice@e2e.test", username: "e2e_alice", password: "password123" },
  bob: { email: "bob@e2e.test", username: "e2e_bob", password: "password123" },
  carol: { email: "carol@e2e.test", username: "e2e_carol", password: "password123" },
} as const;

export const PATTERNS = {
  english: "E2E English Pattern",
  hebrew: "תבנית עברית לבדיקה",
  privateShared: "E2E Private Shared Pattern",
  editableShared: "E2E Editable Shared Pattern",
  permissions: "E2E Permissions Pattern",
  unpublished: "E2E Unpublished Pattern",
  notificationOne: "E2E Notification Pattern One",
  notificationTwo: "E2E Notification Pattern Two",
} as const;

const BACKEND_DIR = path.join(__dirname, "..", "..", "backend");

// Locally, `flask` only exists inside backend/.venv (see Makefile's
// install-backend); in CI, `pip install` runs straight into the runner's
// system Python and `flask` ends up directly on PATH, with no venv at
// all -- ci.yml sets E2E_FLASK_BIN=flask to match. Default to the venv
// path so `make e2e` keeps working with no extra configuration.
const FLASK_BIN = process.env.E2E_FLASK_BIN ?? path.join(BACKEND_DIR, ".venv", "bin", "flask");

/**
 * Shells out to `flask --app wsgi e2e-verify-token <email>` (see
 * backend/app/__init__.py) to read a just-registered user's verification
 * token without needing real email delivery, which is out of scope for
 * this suite. Returns null if the user doesn't exist or has no pending
 * token (the CLI command prints nothing in that case).
 */
export function readVerifyToken(email: string): string | null {
  const output = execFileSync(
    FLASK_BIN,
    ["--app", "wsgi", "e2e-verify-token", email],
    {
      cwd: BACKEND_DIR,
      env: { ...process.env, DATABASE_URL: "sqlite:///e2e.db", FLASK_ENV: "development" },
      encoding: "utf-8",
    },
  ).trim();
  return output || null;
}

/**
 * Shells out to `flask --app wsgi e2e-expire-verify-token <email>` (see
 * backend/app/__init__.py) to backdate a pending verification token past
 * its 24-hour lifetime, so the expired-link path can be tested directly.
 */
export function expireVerifyToken(email: string): void {
  execFileSync(FLASK_BIN, ["--app", "wsgi", "e2e-expire-verify-token", email], {
    cwd: BACKEND_DIR,
    env: { ...process.env, DATABASE_URL: "sqlite:///e2e.db", FLASK_ENV: "development" },
  });
}

/** API origin the e2e backend runs on (see Makefile's `e2e` target). */
export const API_BASE_URL = "http://localhost:5001";

/**
 * Creates a fresh pattern owned by `user` through the real submit API
 * (optionally publishing it), so a spec can mutate or delete it without
 * touching seed fixtures other specs depend on. Returns its id.
 */
export async function createPattern(
  user: keyof typeof USERS,
  fields: { title: string; original_url: string; instructions?: Record<string, string[]>; materials?: string },
  options: { publish?: boolean } = {},
): Promise<number> {
  const context = await request.newContext({ baseURL: API_BASE_URL, storageState: `e2e/.auth/${user}.json` });
  try {
    const created = await context.post("/api/patterns/submit", {
      data: {
        materials: "Test materials",
        abbreviations: "",
        instructions: { "Part 1": ["Cast on 20 stitches.", "Knit 2 rows."] },
        ...fields,
      },
    });
    if (!created.ok()) throw new Error(`createPattern failed: ${created.status()} ${await created.text()}`);
    const id = (await created.json()).pattern.id as number;
    if (options.publish) {
      const published = await context.post(`/api/patterns/${id}/publish`);
      if (!published.ok()) throw new Error(`publish failed: ${published.status()}`);
    }
    return id;
  } finally {
    await context.dispose();
  }
}
