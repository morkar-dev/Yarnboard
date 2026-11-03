/**
 * Adding a pattern from pasted text or from photos (SubmitPatternPage's
 * "Paste text" / "Photos" tabs). The text path runs fully for real. The
 * photo path needs Gemini, which the e2e backend deliberately has no key
 * for (see the Makefile's e2e target), so the happy-path test stubs only
 * the /preview-photos response -- resizing in the browser, the review page,
 * saving, and uploading the first photo as the pattern's picture are all
 * real -- and a second test checks the real "couldn't read" error.
 */
import { expect, test, type Page } from "@playwright/test";

test.use({ storageState: "e2e/.auth/alice.json" });

// A 60x80 JPEG -- enough for the browser to decode and the backend to accept.
const TINY_JPEG = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCABQADwDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwC5RRRXrHeFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFAH//Z", "base64");

function photoFile(name: string) {
  return { name, mimeType: "image/jpeg", buffer: TINY_JPEG };
}

async function openTab(page: Page, name: string) {
  await page.goto("/submit");
  await page.getByRole("button", { name }).click();
}

test("pasted text becomes a pattern with sections, parts, and no source link", async ({ page }) => {
  await openTab(page, "Paste text");
  await page.getByLabel("Pattern text").fill(
    [
      "E2E Pasted Beanie",
      "Designed by Jane Doe",
      "Materials:",
      "- 2 skeins of yarn",
      "Instructions:",
      "Brim:",
      "Cast on 96.",
      "Rows 1-3: k2, p2.",
    ].join("\n"),
  );
  await page.getByRole("button", { name: "Preview" }).click();

  await expect(page).toHaveURL(/\/submit\/review$/);
  await expect(page.getByText("No original link - this pattern will be saved without one.")).toBeVisible();
  await expect(page.getByLabel("Title")).toHaveValue("E2E Pasted Beanie");
  await expect(page.getByRole("group", { name: "Materials" }).getByLabel("Material 1", { exact: true })).toHaveValue("- 2 skeins of yarn");

  await page.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL(/\/pattern\/\d+$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("E2E Pasted Beanie");
  await expect(page.getByLabel("Cast on 96.")).toBeVisible();
  await expect(page.getByText("Jane Doe")).toBeVisible();
  // No original page, so no attribution link.
  await expect(page.locator(".small.text-muted a.link-primary")).toHaveCount(0);
});

test("pasted text with an original link keeps it", async ({ page }) => {
  await openTab(page, "Paste text");
  await page.getByLabel("Pattern text").fill("E2E Linked Scarf\nCast on 20.\nKnit to 150cm.");
  await page.getByLabel("Original link (optional)").fill("https://example.com/e2e-linked-scarf");
  await page.getByRole("button", { name: "Preview" }).click();

  await expect(page.getByText("https://example.com/e2e-linked-scarf")).toBeVisible();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("link", { name: "example.com" })).toHaveAttribute(
    "href",
    "https://example.com/e2e-linked-scarf",
  );
  // No headings in the text, so every line after the title is one checklist.
  await expect(page.getByLabel("Knit to 150cm.")).toBeVisible();
});

test("photos: thumbnails, then the draft and first photo carry through to the saved pattern", async ({ page }) => {
  let uploadedPhotoCount = 0;
  await page.route("**/api/patterns/preview-photos", async (route) => {
    const body = route.request().postDataBuffer() ?? Buffer.alloc(0);
    uploadedPhotoCount = (body.toString("latin1").match(/name="photos"/g) ?? []).length;
    await route.fulfill({
      json: {
        duplicate: false,
        existing_pattern_id: null,
        already_shared_with_you: null,
        draft: {
          title: "E2E Photo Mittens",
          author: null,
          materials: "Worsted yarn",
          abbreviations: "",
          instructions: { Cuff: ["Cast on 40.", "Rib 12 rounds."] },
          source_site_name: null,
          source_domain: null,
          photo_url: null,
        },
      },
    });
  });

  await openTab(page, "Photos");
  const input = page.getByLabel("Photos of the pattern");
  await input.setInputFiles([photoFile("page1.jpg"), photoFile("page2.jpg"), photoFile("page3.jpg")]);
  await expect(page.locator(".photo-thumb")).toHaveCount(3);
  await page.getByRole("button", { name: "Remove photo 3" }).click();
  await expect(page.locator(".photo-thumb")).toHaveCount(2);

  await page.getByRole("button", { name: "Read photos" }).click();
  await expect(page).toHaveURL(/\/submit\/review$/);
  expect(uploadedPhotoCount).toBe(2);
  await expect(page.getByLabel("Use this photo as the pattern's picture")).toBeChecked();

  await page.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL(/\/pattern\/\d+$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("E2E Photo Mittens");
  await expect(page.getByLabel("Rib 12 rounds.")).toBeVisible();
  await expect(page.getByRole("img", { name: "E2E Photo Mittens" })).toBeVisible();
});

test("photos: only five are kept", async ({ page }) => {
  await openTab(page, "Photos");
  await page
    .getByLabel("Photos of the pattern")
    .setInputFiles(Array.from({ length: 6 }, (_, i) => photoFile(`p${i}.jpg`)));
  await expect(page.locator(".photo-thumb")).toHaveCount(5);
  await expect(page.getByText("Only the first 5 photos were kept.")).toBeVisible();
  await expect(page.getByLabel("Photos of the pattern")).toBeDisabled();
});

test("photos: a Gemini failure shows a friendly error", async ({ page }) => {
  await openTab(page, "Photos");
  await page.getByLabel("Photos of the pattern").setInputFiles([photoFile("page1.jpg")]);
  await page.getByRole("button", { name: "Read photos" }).click();

  const alert = page.getByRole("alert");
  await expect(alert).toHaveText("We couldn't read those photos right now. Please try again in a moment.");
  await expect(alert).not.toContainText("GEMINI");
});
