import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";

const dirname = typeof __dirname !== "undefined" ? __dirname : path.dirname(fileURLToPath(import.meta.url));

// Separate from vite.config.ts (the production build config) so test-only
// setup never risks affecting `npm run build`.
//
// Two projects:
//   - "unit" (npm test): the jsdom unit tests in src/**/*.test.ts(x).
//   - "storybook" (npm run test:stories): every story in
//     src/**/*.stories.tsx rendered in real headless Chromium, running
//     its play function plus an axe accessibility scan (see
//     .storybook/preview.tsx's a11y parameter).
export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "jsdom",
          setupFiles: ["./src/test/setup.ts"],
          // Vitest's default include glob isn't scoped to src/, so without
          // this it would also pick up the Playwright specs (e2e/, e2e-dev/,
          // e2e-smoke/, visual/) and try to run them as Vitest tests (those
          // import `test`/`expect` from @playwright/test, a different,
          // incompatible test runner). Each has its own runner -- see the
          // playwright*.config.ts files.
          exclude: [...configDefaults.exclude, "e2e/**", "e2e-dev/**", "e2e-smoke/**", "visual/**"],
        },
      },
      {
        extends: true,
        plugins: [
          // Runs the stories from .storybook/main.ts as tests. Options:
          // https://storybook.js.org/docs/writing-tests/integrations/vitest-addon#storybooktest
          storybookTest({ configDir: path.join(dirname, ".storybook") }),
        ],
        // Pre-bundled up front: if Vite discovers one of these mid-run it
        // reloads the browser and the run fails.
        optimizeDeps: {
          include: [
            "msw/browser",
            "msw-storybook-addon/csf3",
            "react-router-dom",
            "react-bootstrap",
            "react-i18next",
            "i18next",
          ],
        },
        test: {
          name: "storybook",
          browser: {
            enabled: true,
            headless: true,
            provider: "playwright",
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
