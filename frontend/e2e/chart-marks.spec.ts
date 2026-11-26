/**
 * Marking cells on a pattern's Stitch Fiddle chart (ChartTracker).
 *
 * The test pattern is real, but a chart only comes from a Stitch Fiddle
 * import, which an offline run can't do (see stitch-fiddle.spec.ts). So
 * the pattern's GET response gets a small chart added in the browser, and
 * the save call (PUT .../chart-marks) is answered here too, which also
 * lets the test read what was sent. The endpoint itself is covered by
 * backend/tests/test_chart_marks.py.
 */
import { expect, test, type Page, type Route } from "@playwright/test";
import { createPattern } from "./fixtures";

/** A fresh pattern of alice's, `label` making its title and URL unique. */
const newPattern = (label: string, publish = false) => {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return createPattern(
    "alice",
    { title: `E2E ${label} ${stamp}`, original_url: `https://example.com/e2e-chart-${stamp}` },
    { publish },
  );
};

const COLUMNS = 6;
const ROWS = 4;
const CHART = {
  column_count: COLUMNS,
  row_count: ROWS,
  palette: [
    { hex: "#f4ecf6", label: "Background" },
    { hex: "#1d1d1d", label: "Black" },
  ],
  cells: Array.from({ length: COLUMNS * ROWS }, (_, i) => i % 2),
};

/** Serves `patternId` with CHART and keeps "server" marks in `store`. */
async function fakeChart(page: Page, patternId: number, store: { marks: number[]; saves: number[][] }) {
  await page.route(new RegExp(`/api/patterns/${patternId}$`), async (route: Route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const response = await route.fetch();
    const pattern = await response.json();
    await route.fulfill({ response, json: { ...pattern, chart_grid: { ...CHART, marked_cells: store.marks } } });
  });
  await page.route(new RegExp(`/api/patterns/${patternId}/chart-marks$`), async (route) => {
    const body = route.request().postDataJSON() as { marked_cells: number[] };
    store.marks = [...new Set(body.marked_cells)].sort((a, b) => a - b);
    store.saves.push(store.marks);
    await route.fulfill({ json: { marked_cells: store.marks } });
  });
}

const cell = (page: Page, index: number) => page.locator(`td[data-cell="${index}"]`);

test.describe("logged in", () => {
  test.use({ storageState: "e2e/.auth/alice.json" });

  test("tap to mark and unmark; marks are saved to the account", async ({ page }) => {
    const patternId = await newPattern("Chart Marks");
    const store = { marks: [] as number[], saves: [] as number[][] };
    await fakeChart(page, patternId, store);
    await page.goto(`/pattern/${patternId}`);

    await expect(page.getByText(`0 / ${COLUMNS * ROWS} marked`)).toBeVisible();
    await cell(page, 0).click();
    await cell(page, 7).click();
    await expect(cell(page, 0)).toHaveAttribute("data-marked", "true");
    await expect(page.getByText(`2 / ${COLUMNS * ROWS} marked`)).toBeVisible();

    // Saved once, after the clicks settle.
    await expect.poll(() => store.marks).toEqual([0, 7]);
    expect(store.saves).toHaveLength(1);

    await cell(page, 0).click();
    await expect(cell(page, 0)).not.toHaveAttribute("data-marked");
    await expect.poll(() => store.marks).toEqual([7]);

    // Back from the "server" after a reload.
    await page.reload();
    await expect(cell(page, 7)).toHaveAttribute("data-marked", "true");
    await expect(page.getByText(`1 / ${COLUMNS * ROWS} marked`)).toBeVisible();
  });

  test("dragging with the mouse marks every cell it crosses", async ({ page }) => {
    const patternId = await newPattern("Chart Drag");
    const store = { marks: [] as number[], saves: [] as number[][] };
    await fakeChart(page, patternId, store);
    await page.goto(`/pattern/${patternId}`);
    await page.getByRole("button", { name: "L", exact: true }).click(); // bigger cells to aim at

    const start = await cell(page, COLUMNS).boundingBox(); // row 1, column 0
    const end = await cell(page, COLUMNS + 4).boundingBox(); // row 1, column 4
    await page.mouse.move(start!.x + start!.width / 2, start!.y + start!.height / 2);
    await page.mouse.down();
    await page.mouse.move(end!.x + end!.width / 2, end!.y + end!.height / 2, { steps: 8 });
    await page.mouse.up();

    await expect.poll(() => store.marks).toEqual([6, 7, 8, 9, 10]);
    await expect(page.getByText(`5 / ${COLUMNS * ROWS} marked`)).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Clear marks" }).click();
    await expect.poll(() => store.marks).toEqual([]);
  });

  test("a failed save puts the marks back and says so", async ({ page }) => {
    const patternId = await newPattern("Chart Save Fails");
    const store = { marks: [] as number[], saves: [] as number[][] };
    await fakeChart(page, patternId, store);
    await page.route(new RegExp(`/api/patterns/${patternId}/chart-marks$`), (route) =>
      route.fulfill({ status: 500, json: { error: "boom" } }),
    );
    await page.goto(`/pattern/${patternId}`);

    await cell(page, 3).click();
    await expect(page.getByText("Couldn't save your marks. Please try again.")).toBeVisible();
    await expect(cell(page, 3)).not.toHaveAttribute("data-marked");
  });
});

test("a guest's marks stay in this browser", async ({ page }) => {
  const patternId = await newPattern("Chart Guest", true);
  const store = { marks: [] as number[], saves: [] as number[][] };
  await fakeChart(page, patternId, store);
  await page.goto(`/pattern/${patternId}`);

  await expect(page.getByText("As a guest, marks are saved on this device only.")).toBeVisible();
  await cell(page, 2).click();
  await page.reload();
  await expect(cell(page, 2)).toHaveAttribute("data-marked", "true");
  expect(store.saves).toHaveLength(0);
});
