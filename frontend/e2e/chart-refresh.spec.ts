/**
 * "Refresh from Stitch Fiddle" on a chart pattern's page.
 *
 * As in chart-marks.spec.ts, the pattern is real but its chart is added in
 * the browser (a chart only comes from a real Stitch Fiddle import), and
 * the refresh call is answered here: the real one opens stitchfiddle.com on
 * the server. backend/tests/test_stitch_fiddle_refresh.py covers the
 * endpoint itself.
 */
import { expect, test, type Page } from "@playwright/test";
import { createPattern } from "./fixtures";

test.use({ storageState: "e2e/.auth/alice.json" });

const chart = (columns: number, rows: number) => ({
  column_count: columns,
  row_count: rows,
  palette: [{ hex: "#6b3f73", label: "Eggplant" }],
  cells: Array(columns * rows).fill(0),
  marked_cells: [],
});

/** A real pattern of alice's served with a chart; `loaded()` is the
 * pattern as the page last received it, to build refresh answers from. */
async function newChartPattern(page: Page, source_domain = "stitchfiddle.com") {
  let last: Record<string, unknown> = {};
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const patternId = await createPattern("alice", {
    title: `E2E Chart Refresh ${stamp}`,
    original_url: `https://example.com/e2e-refresh-${stamp}`,
  });
  await page.route(new RegExp(`/api/patterns/${patternId}$`), async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const response = await route.fetch();
    const pattern = await response.json();
    last = { ...pattern, source_domain, chart_grid: chart(4, 3) };
    await route.fulfill({ response, json: last });
  });
  return { patternId, loaded: () => last };
}

const button = (page: Page) => page.getByRole("button", { name: "Refresh from Stitch Fiddle" });

test("refreshing a Stitch Fiddle chart shows the new chart", async ({ page }) => {
  const { patternId, loaded } = await newChartPattern(page);
  await page.route(`**/api/stitch-fiddle/patterns/${patternId}/refresh`, async (route) => {
    await route.fulfill({
      json: {
        message: "Chart updated.",
        changed: true,
        pattern: { ...loaded(), chart_grid: chart(6, 5) },
      },
    });
  });
  await page.goto(`/pattern/${patternId}`);
  await expect(page.getByText("0 / 12 marked")).toBeVisible();

  await button(page).click();

  await expect(page.getByText("Chart updated from Stitch Fiddle.")).toBeVisible();
  await expect(page.getByText("0 / 30 marked")).toBeVisible();
  await expect(page.locator("td[data-cell]")).toHaveCount(30);
});

test("an up-to-date chart says so, and a failed fetch shows the error", async ({ page }) => {
  const { patternId, loaded } = await newChartPattern(page);
  let fail = false;
  await page.route(`**/api/stitch-fiddle/patterns/${patternId}/refresh`, async (route) => {
    if (fail) {
      await route.fulfill({
        status: 502,
        json: { error: "This chart isn't public.", code: "stitchfiddle_fetch_error" },
      });
      return;
    }
    await route.fulfill({
      json: {
        message: "The chart is already up to date.",
        changed: false,
        pattern: loaded(),
      },
    });
  });
  await page.goto(`/pattern/${patternId}`);

  await button(page).click();
  await expect(page.getByText("The chart is already up to date.")).toBeVisible();

  fail = true;
  await button(page).click();
  await expect(page.getByText("This chart isn't public.")).toBeVisible();
});

test("there's no refresh button on a chart that isn't from Stitch Fiddle", async ({ page }) => {
  const { patternId } = await newChartPattern(page, "example.com");
  await page.goto(`/pattern/${patternId}`);

  await expect(page.getByText("0 / 12 marked")).toBeVisible();
  await expect(button(page)).toHaveCount(0);
});
