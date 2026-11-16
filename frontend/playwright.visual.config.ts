import { defineConfig, devices } from "@playwright/test";

/**
 * Visual regression for every Storybook story (see visual/stories.spec.ts).
 * Runs against the static build (`npm run build-storybook` first), served
 * locally -- nothing is uploaded to any third-party service.
 *
 * Fonts and anti-aliasing differ per OS, so baselines are kept per
 * platform (visual/__screenshots__/darwin/, .../linux/). In the default
 * mode a baseline that doesn't exist yet is written and the test passes
 * with a "new baseline" note (see visual/stories.spec.ts); with
 * `--update-snapshots=none` a missing baseline fails. CI fails the job
 * whenever a run had to write a new Linux baseline (.gitlab-ci.yml), so
 * they must be committed before anything passes there.
 * After an intended UI change: `npm run test:visual:update`, review the
 * changed PNGs in the diff, commit.
 */
const PORT = 6007;

export default defineConfig({
  testDir: "./visual",
  snapshotPathTemplate: "{testDir}/__screenshots__/{platform}/{arg}{ext}",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { outputFolder: "visual-report", open: "never" }]],
  expect: {
    toHaveScreenshot: {
      // A fixed pixel allowance, not a ratio: most of a full-page shot is
      // empty background, so even 0.2% (~2000px) would hide a recolored
      // button. 25px absorbs anti-aliasing noise and nothing more.
      maxDiffPixels: 25,
      animations: "disabled",
      caret: "hide",
      stylePath: "./visual/screenshot.css",
    },
  },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } }],
  webServer: {
    command: `npx vite preview --outDir storybook-static --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
  },
});
