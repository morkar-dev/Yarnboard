import { expect, test } from "@playwright/test";
import fs from "node:fs";
import { PHOTO_FILE, REQUIRED_FLAGS, SMOKE_PATTERN_TITLE, STATE_FILE } from "./fixtures";

const { patternId } = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8")) as { patternId: number };

// Long enough for the backend's own Gemini retries (60 s per attempt, up
// to 4 attempts) to finish, so a failure shows the API's error body
// rather than a client-side timeout. On Render, gunicorn's 90 s worker
// timeout ends it sooner.
const GEMINI_TIMEOUT_MS = 270_000;

test("health: required settings are present on this deployment", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.ok()).toBe(true);
  const { config } = (await response.json()) as { config: Record<string, boolean> };

  // Show every flag in the report, required or not.
  for (const [name, value] of Object.entries(config)) {
    test.info().annotations.push({ type: name, description: String(value) });
  }

  const missing = REQUIRED_FLAGS.filter((flag) => config[flag] !== true);
  expect(
    missing,
    `Not set on this deployment: ${missing.join(", ")} ` +
      `(proxy_verified false with proxy_secret true means the Worker's PROXY_SHARED_SECRET doesn't match the API's)`,
  ).toEqual([]);
});

test("site: logged-in user can open their pattern", async ({ page }) => {
  await page.goto(`/pattern/${patternId}`);
  await expect(page.getByText(SMOKE_PATTERN_TITLE).first()).toBeVisible({ timeout: 30_000 });
});

test("paste text: preview parses a pattern", async ({ request }) => {
  const response = await request.post("/api/patterns/preview-text", {
    data: { text: "Coaster\n\nMaterials:\nYarn\n\nInstructions:\nRound 1: 6 sc in ring." },
  });
  expect(response.status(), await response.text()).toBe(200);
  expect((await response.json()).draft).toBeTruthy();
});

test("photo upload: Gemini reads a pattern photo", async ({ request }) => {
  test.setTimeout(GEMINI_TIMEOUT_MS + 30_000);
  const response = await request.post("/api/patterns/preview-photos", {
    multipart: {
      photos: { name: "pattern-photo.jpg", mimeType: "image/jpeg", buffer: fs.readFileSync(PHOTO_FILE) },
    },
    timeout: GEMINI_TIMEOUT_MS,
  });
  expect(response.status(), await response.text()).toBe(200);
  const { draft } = await response.json();
  expect(JSON.stringify(draft).toLowerCase()).toContain("magic ring");
});

test("translation: Gemini translates a pattern to Hebrew", async ({ request }) => {
  test.setTimeout(GEMINI_TIMEOUT_MS + 30_000);
  const response = await request.post(`/api/patterns/${patternId}/translate`, {
    timeout: GEMINI_TIMEOUT_MS,
  });
  expect(response.status(), await response.text()).toBe(200);
  const he = (await response.json()).pattern.translations?.he;
  expect(he?.title, "no Hebrew title came back").toBeTruthy();
});
