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

/** Mirrors .storybook/preview.tsx's viewport options. */
const VIEWPORTS: Record<string, { width: number; height: number }> = {
  mobile: { width: 375, height: 812 },
  tablet: { width: 768, height: 1024 },
};

/** Wait until Storybook has rendered the story and finished its play
 * function; returns the final phase ("errored"/"aborted" on failure). */
async function waitForStory(page: import("@playwright/test").Page): Promise<string> {
  const phase = await page.waitForFunction(
    () => {
      const p = (window as unknown as { __STORYBOOK_PREVIEW__?: { currentRender?: { phase?: string } } })
        .__STORYBOOK_PREVIEW__?.currentRender?.phase;
      return p === "completed" || p === "finished" || p === "errored" || p === "aborted" ? p : false;
    },
    undefined,
    { timeout: 20_000 },
  );
  return (await phase.jsonValue()) as string;
}

/**
 * Storybook marks a story "finished" even when its play function threw --
 * the error only reaches its own event channel (and the console). Listen on
 * that channel from the moment Storybook creates it, before any story code
 * runs, so a failed play fails the test instead of being screenshotted
 * half-done (e.g. a Hebrew run of steps that look for English labels).
 */
function collectStoryErrors() {
  const errors: string[] = [];
  (window as unknown as { __ybStoryErrors: string[] }).__ybStoryErrors = errors;
  let channel: { on: (event: string, listener: (payload: unknown) => void) => void } | undefined;
  Object.defineProperty(window, "__STORYBOOK_ADDONS_CHANNEL__", {
    configurable: true,
    get: () => channel,
    set(value) {
      channel = value;
      for (const event of ["playFunctionThrewException", "storyThrewException", "storyErrored", "unhandledErrorsWhilePlaying"]) {
        value.on(event, (payload: unknown) => {
          const detail = payload as { message?: string; description?: string } | undefined;
          errors.push(`${event}: ${detail?.message ?? detail?.description ?? String(payload)}`);
        });
      }
    },
  });
}

for (const story of stories) {
  for (const locale of LOCALES) {
    test(`${story.title} / ${story.name} [${locale}]`, async ({ page }) => {
      await page.addInitScript(collectStoryErrors);
      const url = `/iframe.html?id=${story.id}&viewMode=story&globals=locale:${locale}`;
      await page.goto(url);
      await expect(await waitForStory(page)).toMatch(/^(completed|finished)$/);

      // Storybook's own UI sizes the frame for a story's viewport global
      // (e.g. "Mobile" stories); this bare page doesn't, so do it here and
      // reload, letting the play function run again at the right size.
      const viewport = await page.evaluate(() => {
        type Globals = { viewport?: { value?: string } };
        const story = (window as unknown as {
          __STORYBOOK_PREVIEW__?: { currentRender?: { story?: { storyGlobals?: Globals; globals?: Globals } } };
        }).__STORYBOOK_PREVIEW__?.currentRender?.story;
        return story?.storyGlobals?.viewport?.value ?? story?.globals?.viewport?.value;
      });
      if (viewport && viewport !== "desktop") {
        const size = VIEWPORTS[viewport];
        expect(size, `unknown viewport "${viewport}" -- add it to VIEWPORTS`).toBeDefined();
        await page.setViewportSize(size);
        await page.goto(url);
        await expect(await waitForStory(page)).toMatch(/^(completed|finished)$/);
      }

      const storyErrors = await page.evaluate(() => (window as unknown as { __ybStoryErrors: string[] }).__ybStoryErrors);
      expect(storyErrors, "the story's play function or render threw").toEqual([]);

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

      // No baseline for this OS yet (a new story, or the first run on a
      // new OS): in the default "missing" mode, save one and pass with a
      // note, instead of Playwright's own behavior there (write the file,
      // fail the test anyway). Every other mode goes to toHaveScreenshot:
      //   - "none" is the strict mode -- a missing baseline must fail;
      //   - "all"/"changed" (--update-snapshots) rewrite as usual.
      // Passing here is not the end of it in CI: the frontend-stories job
      // fails if a run wrote any new Linux baseline (see .gitlab-ci.yml),
      // so new PNGs have to be downloaded from its artifacts and committed.
      if (info.config.updateSnapshots === "missing" && !existsSync(baseline)) {
        mkdirSync(path.dirname(baseline), { recursive: true });
        await page.screenshot({ path: baseline, fullPage: true, animations: "disabled", caret: "hide", style: SCREENSHOT_CSS });
        info.annotations.push({ type: "new baseline", description: path.relative(here, baseline) });
        return;
      }

      await expect(page).toHaveScreenshot(name, { fullPage: true });
    });
  }
}
