import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: [
    "@storybook/addon-vitest",
    "@storybook/addon-a11y",
    "@storybook/addon-docs",
    "@storybook/addon-mcp",
  ],
  framework: "@storybook/react-vite",
  // Holds only MSW's mockServiceWorker.js -- kept out of frontend/public
  // so the fake-API worker never ships in the production build.
  staticDirs: ["./public"],
  core: {
    disableTelemetry: true,
  },
};
export default config;
