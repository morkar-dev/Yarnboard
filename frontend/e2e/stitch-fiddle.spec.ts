/**
 * The Stitch Fiddle page: saving, importing and removing chart links.
 *
 * Saving and removing go through the real backend. Importing doesn't: the
 * real import opens stitchfiddle.com in a headless browser on the server,
 * which an offline, repeatable test run can't depend on -- so the import
 * test fakes that one API response in the browser and checks the page
 * handles both outcomes (success and failure). The real fetch/decode is
 * covered by backend unit tests and stays part of manual QA.
 */
import { expect, test } from "@playwright/test";
import { createPattern } from "./fixtures";

test.use({ storageState: "e2e/.auth/alice.json" });

const linkFor = (chartId: string) => `https://www.stitchfiddle.com/c/${chartId}`;

test("a link that isn't a Stitch Fiddle chart is refused", async ({ page }) => {
  await page.goto("/stitch-fiddle");
  await page.getByLabel("Stitch Fiddle chart link").fill("https://example.com/not-a-chart");
  const saved = page.waitForResponse(
    (res) => res.url().endsWith("/api/stitch-fiddle/links") && res.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Save link" }).click();
  expect((await saved).status()).toBe(400);
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("link", { name: "https://example.com/not-a-chart" })).toHaveCount(0);
});

test("save a link, then remove it", async ({ page }) => {
  const url = linkFor(`e2e-save-${Date.now()}`);
  await page.goto("/stitch-fiddle");

  await page.getByLabel("Stitch Fiddle chart link").fill(url);
  await page.getByRole("button", { name: "Save link" }).click();
  const row = page.locator(".list-group-item").filter({ has: page.getByRole("link", { name: url }) });
  await expect(row).toBeVisible();
  await expect(page.getByLabel("Stitch Fiddle chart link")).toHaveValue("");

  // Saved server-side.
  await page.reload();
  await expect(row.getByRole("button", { name: "Import" })).toBeVisible();

  await row.getByRole("button", { name: "Remove" }).click();
  await expect(row).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("link", { name: url })).toHaveCount(0);
});

test("import: success turns the row into a link to the new pattern; failure shows an error on that row", async ({
  page,
}) => {
  // Stands in for the pattern a real import would create.
  const patternId = await createPattern("alice", {
    title: `E2E Imported Chart ${Date.now()}`,
    original_url: `https://example.com/e2e-chart-${Date.now()}`,
  });

  const okUrl = linkFor(`e2e-import-ok-${Date.now()}`);
  const badUrl = linkFor(`e2e-import-bad-${Date.now()}`);
  await page.goto("/stitch-fiddle");
  for (const url of [okUrl, badUrl]) {
    await page.getByLabel("Stitch Fiddle chart link").fill(url);
    await page.getByRole("button", { name: "Save link" }).click();
    await expect(page.getByRole("link", { name: url })).toBeVisible();
  }
  const okRow = page.locator(".list-group-item").filter({ has: page.getByRole("link", { name: okUrl }) });
  const badRow = page.locator(".list-group-item").filter({ has: page.getByRole("link", { name: badUrl }) });

  // Fake only the import call, per row.
  let okLinkId: number | null = null;
  await page.route(/\/api\/stitch-fiddle\/links\/\d+\/import$/, async (route) => {
    const linkId = Number(route.request().url().match(/links\/(\d+)\/import/)![1]);
    if (okLinkId === null) okLinkId = linkId;
    if (linkId === okLinkId) {
      await route.fulfill({
        json: { message: "Imported.", pattern: { id: patternId } },
      });
    } else {
      await route.fulfill({
        status: 502,
        json: { error: "This chart isn't shared publicly on Stitch Fiddle.", code: "stitch_fiddle_error" },
      });
    }
  });

  await okRow.getByRole("button", { name: "Import" }).click();
  await expect(okRow.getByRole("link", { name: "View pattern" })).toHaveAttribute("href", `/pattern/${patternId}`);

  await badRow.getByRole("button", { name: "Import" }).click();
  await expect(badRow.getByRole("alert")).toBeVisible();
  await expect(badRow.getByRole("button", { name: "Import" })).toBeEnabled();

  // Clean up the saved links.
  await page.unroute(/\/api\/stitch-fiddle\/links\/\d+\/import$/);
  for (const row of [okRow, badRow]) await row.getByRole("button", { name: "Remove" }).click();
  await expect(okRow).toHaveCount(0);
  await expect(badRow).toHaveCount(0);
});
