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
import { readFileSync } from "node:fs";
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

      await expect(page).toHaveScreenshot(`${story.id}--${locale}.png`, { fullPage: true });
    });
  }
}
