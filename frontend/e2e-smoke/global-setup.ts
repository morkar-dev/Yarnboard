import { request, type APIRequestContext } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { deleteSmokePatterns } from "./cleanup";
import {
  AUTH_FILE,
  SMOKE_BASE_URL,
  SMOKE_EMAIL,
  SMOKE_PASSWORD,
  SMOKE_PATTERN_TITLE,
  STATE_FILE,
} from "./fixtures";

// Render's free tier sleeps when idle and answers 429
// (x-render-routing: hibernate-rate-limited) while it wakes, which can
// take a few minutes. Wait that out before judging anything.
const WAKE_TIMEOUT_MS = 6 * 60_000;
const WAKE_POLL_MS = 15_000;

async function waitForApi(api: APIRequestContext) {
  const deadline = Date.now() + WAKE_TIMEOUT_MS;
  let last = "no response yet";
  while (Date.now() < deadline) {
    try {
      const response = await api.get("/api/health", { timeout: 30_000 });
      if (response.ok()) return;
      const headers = response.headers();
      last =
        `HTTP ${response.status()}` +
        (headers["x-render-routing"] ? `, x-render-routing: ${headers["x-render-routing"]}` : "") +
        (headers["cf-mitigated"] ? `, cf-mitigated: ${headers["cf-mitigated"]} (Cloudflare challenge)` : "");
    } catch (error) {
      last = String(error);
    }
    console.log(`[smoke] API not ready (${last}); retrying...`);
    await new Promise((resolve) => setTimeout(resolve, WAKE_POLL_MS));
  }
  throw new Error(`[smoke] API at ${SMOKE_BASE_URL()} never became ready: ${last}`);
}

/** Deletes leftovers from earlier runs, then creates a fresh pattern --
 * fresh so translation really calls Gemini (an already-translated
 * pattern is answered from the database). global-teardown.ts deletes it. */
async function createFreshSmokePattern(api: APIRequestContext, username: string): Promise<number> {
  await deleteSmokePatterns(api);

  const created = await api.post("/api/patterns/submit", {
    data: {
      original_url: `https://example.com/yarnboard-smoke-test/${encodeURIComponent(username)}/${Date.now()}`,
      title: SMOKE_PATTERN_TITLE,
      materials: "Worsted weight yarn\n4 mm crochet hook",
      instructions: {
        "Round 1": ["Magic ring, 6 sc into ring."],
        "Round 2": ["2 sc in each st around."],
      },
    },
  });
  if (!created.ok()) {
    throw new Error(`[smoke] creating the smoke pattern failed: HTTP ${created.status()} ${await created.text()}`);
  }
  return (await created.json()).pattern.id;
}

export default async function globalSetup() {
  const api = await request.newContext({ baseURL: SMOKE_BASE_URL() });
  try {
    await waitForApi(api);

    const login = await api.post("/api/login", {
      data: { email: SMOKE_EMAIL(), password: SMOKE_PASSWORD() },
    });
    if (!login.ok()) {
      // Never print the request body: it holds the password.
      throw new Error(`[smoke] login as the smoke account failed: HTTP ${login.status()} ${await login.text()}`);
    }
    const { username } = await login.json();

    const patternId = await createFreshSmokePattern(api, username);

    fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
    await api.storageState({ path: AUTH_FILE });
    fs.writeFileSync(STATE_FILE, JSON.stringify({ patternId }, null, 2));
  } finally {
    await api.dispose();
  }
}
