/**
 * A pattern's life after it's saved: adding/replacing/removing its photo,
 * the "this pattern changed" banner when its owner edits the steps someone
 * else is working through, deleting it, and submitting a URL that's
 * already been shared with you. Every test makes its own pattern through
 * the real API (see createPattern in fixtures.ts), so none of them can
 * disturb the seed fixtures other specs rely on.
 */
import { expect, request, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { API_BASE_URL, createPattern, USERS } from "./fixtures";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PHOTO = path.join(__dirname, "..", "e2e-smoke", "pattern-photo.jpg");

test.describe("pattern photo on the Edit page", () => {
  test.use({ storageState: "e2e/.auth/alice.json" });

  test("upload, replace, then remove the photo", async ({ page }) => {
    const title = `E2E Photo Pattern ${Date.now()}`;
    const id = await createPattern("alice", { title, original_url: `https://example.com/e2e-photo-${Date.now()}` });

    await page.goto(`/pattern/${id}/edit`);
    await expect(page.getByRole("button", { name: "Upload photo" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Remove photo" })).toHaveCount(0);

    // Upload.
    await page.getByLabel("Photo of the finished piece").setInputFiles(PHOTO);
    const uploaded = page.waitForResponse(
      (res) => res.url().endsWith(`/api/patterns/${id}/photo`) && res.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Upload photo" }).click();
    expect((await uploaded).ok()).toBe(true);
    await expect(page.getByRole("button", { name: "Remove photo" })).toBeVisible();
    // Shown twice on this page: in the photo section and the review form.
    await expect(page.getByRole("img", { name: title }).first()).toBeVisible();

    // The photo is served and shown on the pattern page too.
    const api = await request.newContext({ baseURL: API_BASE_URL, storageState: "e2e/.auth/alice.json" });
    const photo = await api.get(`/api/patterns/${id}/photo`);
    expect(photo.ok()).toBe(true);
    expect(photo.headers()["content-type"]).toContain("image/");

    // Replace. (A different file name: re-selecting the identical file
    // fires no change event, just as in a real browser.)
    await page.getByLabel("Photo of the finished piece").setInputFiles({
      name: "replacement.jpg",
      mimeType: "image/jpeg",
      buffer: readFileSync(PHOTO),
    });
    const replaced = page.waitForResponse(
      (res) => res.url().endsWith(`/api/patterns/${id}/photo`) && res.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Replace photo" }).click();
    expect((await replaced).ok()).toBe(true);

    // Remove.
    await page.getByRole("button", { name: "Remove photo" }).click();
    await expect(page.getByRole("button", { name: "Remove photo" })).toHaveCount(0);
    await expect(page.getByRole("img", { name: title })).toHaveCount(0);
    expect((await (await api.get(`/api/patterns/${id}`)).json()).has_photo).toBe(false);
    await api.dispose();

    await page.goto(`/pattern/${id}`);
    await expect(page.getByRole("img", { name: title })).toHaveCount(0);
  });

  test("a file that isn't an image is refused with a message", async ({ page }) => {
    const id = await createPattern("alice", {
      title: `E2E Bad Photo Pattern ${Date.now()}`,
      original_url: `https://example.com/e2e-bad-photo-${Date.now()}`,
    });
    await page.goto(`/pattern/${id}/edit`);
    await page.getByLabel("Photo of the finished piece").setInputFiles({
      name: "not-a-photo.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from("this is not an image"),
    });
    await page.getByRole("button", { name: "Upload photo" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("button", { name: "Remove photo" })).toHaveCount(0);
  });
});

test("editing a pattern's steps shows the 'changed' banner to someone mid-way, and dismissing it clears their progress", async ({
  browser,
}) => {
  const title = `E2E Changed Pattern ${Date.now()}`;
  const id = await createPattern(
    "alice",
    { title, original_url: `https://example.com/e2e-changed-${Date.now()}` },
    { publish: true },
  );

  // e2e_bob ticks a step.
  const bobContext = await browser.newContext({ storageState: "e2e/.auth/bob.json" });
  const bob = await bobContext.newPage();
  await bob.goto(`/pattern/${id}`);
  const ticked = bob.waitForResponse(
    (res) => res.url().endsWith(`/api/patterns/${id}/progress`) && res.request().method() === "PATCH",
  );
  await bob.getByLabel("Cast on 20 stitches.").check();
  expect((await ticked).ok()).toBe(true);

  // No banner yet: nothing has changed.
  await bob.goto("/community");
  await expect(bob.getByText("has changed since you last worked on it")).toHaveCount(0);

  // e2e_alice edits the steps.
  const aliceApi = await request.newContext({ baseURL: API_BASE_URL, storageState: "e2e/.auth/alice.json" });
  const edited = await aliceApi.patch(`/api/patterns/${id}`, {
    data: {
      title,
      author: null,
      materials: "Test materials",
      abbreviations: "",
      instructions: { "Part 1": ["Cast on 24 stitches.", "Knit 2 rows."] },
    },
  });
  expect(edited.ok(), await edited.text()).toBe(true);
  await aliceApi.dispose();

  // Bob sees the banner on any page.
  await bob.reload();
  const banner = bob.getByRole("alert").filter({ hasText: "has changed since you last worked on it" });
  await expect(banner).toBeVisible();
  await expect(banner.getByRole("link", { name: title })).toHaveAttribute("href", `/pattern/${id}`);

  // Dismissing clears his progress for good.
  const acknowledged = bob.waitForResponse((res) => res.url().endsWith(`/api/patterns/${id}/acknowledge-update`));
  await banner.getByRole("button", { name: /close/i }).click();
  expect((await acknowledged).ok()).toBe(true);
  await expect(banner).toHaveCount(0);

  await bob.goto(`/pattern/${id}`);
  await expect(bob.getByLabel("Cast on 24 stitches.")).not.toBeChecked();
  await expect(bob.getByText("has changed since you last worked on it")).toHaveCount(0);
  await bobContext.close();
});

test.describe("deleting a pattern", () => {
  test.use({ storageState: "e2e/.auth/alice.json" });

  test("asks first; cancelling keeps it, confirming deletes it everywhere", async ({ page }) => {
    const title = `E2E Delete Me ${Date.now()}`;
    const id = await createPattern("alice", { title, original_url: `https://example.com/e2e-delete-${Date.now()}` });

    await page.goto(`/pattern/${id}`);

    page.once("dialog", (dialog) => dialog.dismiss());
    await page.getByRole("button", { name: "Delete pattern" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);

    page.once("dialog", (dialog) => {
      expect(dialog.message()).toContain("Permanently delete this pattern?");
      return dialog.accept();
    });
    await page.getByRole("button", { name: "Delete pattern" }).click();

    await expect(page).toHaveURL(/\/mine$/);
    await expect(page.getByRole("heading", { name: "My Uploads" })).toBeVisible();
    await expect(page.getByRole("link", { name: title })).toHaveCount(0);

    await page.goto(`/pattern/${id}`);
    await expect(page.getByText("Pattern not found.")).toBeVisible();
  });
});

test.describe("submitting a URL someone already shared with you", () => {
  test.use({ storageState: "e2e/.auth/bob.json" });

  test("warns and offers the shared pattern, but lets you continue with your own copy", async ({ page }) => {
    const stamp = Date.now();
    const url = `https://example.com/e2e-already-shared-${stamp}`;
    const title = `E2E Already Shared ${stamp}`;
    const sharedId = await createPattern("alice", { title, original_url: url });
    const aliceApi = await request.newContext({ baseURL: API_BASE_URL, storageState: "e2e/.auth/alice.json" });
    const shared = await aliceApi.post(`/api/patterns/${sharedId}/shares`, {
      data: { username: USERS.bob.username, can_edit: false },
    });
    expect(shared.ok()).toBe(true);
    await aliceApi.dispose();

    const html = `<html><body><article><h1>${title}</h1><h2>Materials</h2><ul><li>4mm needles</li></ul>
      <h2>Instructions</h2><ol><li>Cast on 20 stitches.</li></ol></article></body></html>`;

    await page.goto("/submit");
    await page.getByRole("button", { name: "Upload a file" }).click();
    await page.getByLabel("Pattern URL").fill(url);
    await page.getByLabel("Saved HTML or PDF file").setInputFiles({
      name: "pattern.html",
      mimeType: "text/html",
      buffer: Buffer.from(html),
    });
    await page.getByRole("button", { name: "Preview from file" }).click();

    await expect(page.getByText("Someone already shared a pattern from this URL with you.")).toBeVisible();
    await expect(page.getByRole("link", { name: "View shared pattern" })).toHaveAttribute("href", `/pattern/${sharedId}`);

    await page.getByRole("button", { name: "Continue with my own copy" }).click();
    await expect(page).toHaveURL(/\/submit\/review$/);
    await expect(page.getByLabel("Title")).toHaveValue(title);
  });
});

test.describe("uploading a PDF", () => {
  test.use({ storageState: "e2e/.auth/alice.json" });

  // pattern-with-author.pdf names its author only in the file's metadata
  // (Author property) -- not in the text -- and was made with "Canva",
  // which must not be mistaken for a person.
  const PDF_FIXTURE = path.join(__dirname, "pattern-with-author.pdf");

  test("needs no link, and takes the author from the file", async ({ page }) => {
    await page.goto("/submit");
    await page.getByRole("button", { name: "Upload a file" }).click();

    // Before a file is picked (or for a saved web page) the link is required.
    await expect(page.getByLabel("Pattern URL")).toHaveAttribute("required", "");

    await page.getByLabel("Saved HTML or PDF file").setInputFiles(PDF_FIXTURE);
    const link = page.getByLabel("Original link (optional)");
    await expect(link).toBeVisible();
    await expect(link).not.toHaveAttribute("required", "");
    await expect(page.getByText("The author is read from the PDF itself.", { exact: false })).toBeVisible();

    await page.getByRole("button", { name: "Preview from file" }).click();
    await expect(page).toHaveURL(/\/submit\/review$/);
    await expect(page.getByLabel("Title")).toHaveValue("E2E PDF Mittens");
    await expect(page.getByLabel("Original author")).toHaveValue("Pdf Author Person");
    await expect(page.getByText("No original link - this pattern will be saved without one.")).toBeVisible();

    await page.getByRole("button", { name: "Save Pattern" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("E2E PDF Mittens");
    await expect(page.getByText("Pdf Author Person")).toBeVisible();
    // No source link to show.
    await expect(page.getByRole("link", { name: /the original site/ })).toHaveCount(0);
  });

  test("a saved web page still asks for its link", async ({ page }) => {
    await page.goto("/submit");
    await page.getByRole("button", { name: "Upload a file" }).click();
    await page.getByLabel("Saved HTML or PDF file").setInputFiles({
      name: "page.html",
      mimeType: "text/html",
      buffer: Buffer.from("<html><body><h1>Some Page</h1></body></html>"),
    });
    await expect(page.getByLabel("Pattern URL")).toHaveAttribute("required", "");
  });
});
