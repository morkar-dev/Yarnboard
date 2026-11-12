/**
 * One screenshot per Storybook story, in English (LTR) and Hebrew (RTL),
 * compared against the committed baseline in visual/__screenshots__/.
 * The story list comes from the built Storybook's own index.json, so a
 * new story is covered automatically.
 *
 * Each story is opened in Storybook's bare iframe, the same page the
 * interaction tests use -- including its play function, so a story like
 * "OpenInboxAndMarkAllRead" is captured in its after-interaction state.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

interface IndexEntry {
  id: string;
  title: string;
  name: string;
  type: "story" | "docs";
}

const here = path.dirname(fileURLToPath(import.meta.url));
const index = JSON.parse(readFileSync(path.join(here, "../storybook-static/index.json"), "utf8")) as {
  entries: Record<string, IndexEntry>;
};
const stories = Object.values(index.entries).filter((e) => e.type === "story");

/** Stories whose final frame is a never-ending spinner/pending state --
 * still rendered (so a crash is caught), just not pixel-compared. */
const NO_SCREENSHOT = new Set(["pages-patterndetailpage--loading", "components-textpatternform--processing"]);

const LOCALES = ["en", "he"] as const;

/** Same CSS toHaveScreenshot applies (playwright.visual.config.ts's
 * stylePath), so a baseline written below matches later comparisons. */
const SCREENSHOT_CSS = readFileSync(path.join(here, "screenshot.css"), "utf8");

for (const story of stories) {
  for (const locale of LOCALES) {
    test(`${story.title} / ${story.name} [${locale}]`, async ({ page }) => {
      await page.goto(`/iframe.html?id=${story.id}&viewMode=story&globals=locale:${locale}`);

      // Wait until Storybook has rendered the story and finished its play
      // function; fail on a render or play error rather than snapshotting it.
      const phase = await page.waitForFunction(
        () => {
          const p = (window as unknown as { __STORYBOOK_PREVIEW__?: { currentRender?: { phase?: string } } })
            .__STORYBOOK_PREVIEW__?.currentRender?.phase;
          return p === "completed" || p === "finished" || p === "errored" || p === "aborted" ? p : false;
        },
        undefined,
        { timeout: 20_000 },
      );
      expect(["completed", "finished"]).toContain(await phase.jsonValue());

      // A play function's last click leaves focus (and sometimes a
      // :focus-visible ring) on whatever it clicked, depending on timing --
      // clear it so the frame is the settled UI, not the last keystroke.
      await page.evaluate(async () => {
        (document.activeElement as HTMLElement | null)?.blur();
        await document.fonts.ready;
      });
      await page.mouse.move(0, 0);
      if (NO_SCREENSHOT.has(story.id)) return;

      const name = `${story.id}--${locale}.png`;
      const info = test.info();
      const baseline = info.snapshotPath(name, { kind: "screenshot" });

      // No baseline for this OS yet (a new story, or CI's very first run
      // on Linux): save one and pass, noting it, instead of failing --
      // Playwright's own "missing" mode writes the file but still fails
      // the test. Review and commit the new PNG (CI keeps them as job
      // artifacts). `--update-snapshots` runs skip this and let
      // toHaveScreenshot rewrite every baseline as usual.
      if (info.config.updateSnapshots !== "all" && info.config.updateSnapshots !== "changed" && !existsSync(baseline)) {
        mkdirSync(path.dirname(baseline), { recursive: true });
        await page.screenshot({ path: baseline, fullPage: true, animations: "disabled", caret: "hide", style: SCREENSHOT_CSS });
        info.annotations.push({ type: "new baseline", description: path.relative(here, baseline) });
        return;
      }

      await expect(page).toHaveScreenshot(name, { fullPage: true });
    });
  }
}
