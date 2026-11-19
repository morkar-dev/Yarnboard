import { defineConfig, devices } from "@playwright/test";
import { AUTH_FILE, SMOKE_BASE_URL } from "./e2e-smoke/fixtures";

/**
 * Smoke tests against a deployed site -- see e2e-smoke/fixtures.ts.
 * Run with `npm run test:smoke` (SMOKE_BASE_URL, SMOKE_EMAIL and
 * SMOKE_PASSWORD set). GitLab runs it via .gitlab-ci.yml's smoke jobs.
 */
export default defineConfig({
  testDir: "./e2e-smoke",
  globalSetup: "./e2e-smoke/global-setup.ts",
  globalTeardown: "./e2e-smoke/global-teardown.ts",
  // The wake-up wait in global-setup can take minutes; that's not a test.
  globalTimeout: 25 * 60_000,
  fullyParallel: false,
  workers: 1,
  // No retries: a failure here is the signal, and retrying the slow
  // Gemini checks would only burn CI minutes.
  retries: 0,
  reporter: [
    ["list"],
    ["junit", { outputFile: "smoke-results/junit.xml" }],
    ["html", { open: "never", outputFolder: "smoke-results/html" }],
  ],
  outputDir: "smoke-results/artifacts",
  use: {
    baseURL: SMOKE_BASE_URL(),
    storageState: AUTH_FILE,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
