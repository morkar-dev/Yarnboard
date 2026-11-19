/**
 * The "Translate to English" button on a Hebrew-original pattern that has
 * no English translation yet.
 *
 * Gemini is switched off for e2e runs (see the Makefile), so the real
 * backend's answer here is always its friendly "couldn't translate" error
 * -- that path is tested for real. The success path fakes the one API
 * response in the browser to check the page shows the new, unreviewed
 * English overlay; real translation quality stays part of manual QA (the
 * deployed smoke test only checks Gemini answers at all).
 */
import { expect, request, test } from "@playwright/test";
import { API_BASE_URL, createPattern } from "./fixtures";

const HEBREW_TITLE = "צעיף לבדיקת תרגום";
const ENGLISH_TITLE = "Translation Test Scarf";

let patternId: number;

test.beforeAll(async () => {
  patternId = await createPattern(
    "alice",
    {
      title: `${HEBREW_TITLE} ${Date.now()}`,
      original_url: `https://example.com/e2e-hebrew-untranslated-${Date.now()}`,
      materials: "מסרגות 4 מ״מ",
      instructions: { "חלק 1": ["העלו 20 עיניים.", "סרגו 2 שורות."] },
    },
    { publish: true },
  );
});

test.describe("logged in", () => {
  test.use({ storageState: "e2e/.auth/bob.json" });

  test("when translation fails, the page says so and keeps the button", async ({ page }) => {
    await page.goto(`/pattern/${patternId}`);
    const button = page.getByRole("button", { name: "Translate to English" });
    await expect(button).toBeVisible();
    // A Hebrew-original pattern never offers "Translate to Hebrew".
    await expect(page.getByRole("button", { name: "Translate to Hebrew" })).toHaveCount(0);

    const translated = page.waitForResponse((res) => res.url().endsWith(`/api/patterns/${patternId}/translate-to-english`));
    await button.click();
    expect((await translated).status()).toBe(502);
    await expect(page.getByText("We couldn't translate this pattern right now.", { exact: false })).toBeVisible();
    await expect(button).toBeEnabled();
  });

  test("when translation succeeds, the English overlay shows, marked as not yet reviewed", async ({ page }) => {
    const api = await request.newContext({ baseURL: API_BASE_URL, storageState: "e2e/.auth/bob.json" });
    const pattern = await (await api.get(`/api/patterns/${patternId}`)).json();
    await api.dispose();

    await page.route(`**/api/patterns/${patternId}/translate-to-english`, (route) =>
      route.fulfill({
        json: {
          message: "Pattern translated to English.",
          pattern: {
            ...pattern,
            translations: {
              ...pattern.translations,
              en: {
                title: ENGLISH_TITLE,
                materials: "4mm needles",
                abbreviations: null,
                instructions: { "חלק 1": { heading_en: "Part 1", steps_en: ["Cast on 20 stitches.", "Knit 2 rows."] } },
                reviewed: false,
              },
            },
          },
        },
      }),
    );

    await page.goto(`/pattern/${patternId}`);
    await page.getByRole("button", { name: "Translate to English" }).click();

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(ENGLISH_TITLE);
    await expect(page.getByText("Machine-translated, not yet reviewed by a person", { exact: false })).toBeVisible();
    await expect(page.getByLabel("Cast on 20 stitches.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Translate to English" })).toHaveCount(0);
  });
});

test("guests aren't offered translation", async ({ page }) => {
  await page.goto(`/pattern/${patternId}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(HEBREW_TITLE);
  await expect(page.getByRole("button", { name: "Translate to English" })).toHaveCount(0);
});
