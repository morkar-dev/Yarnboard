import type { Preview } from "@storybook/react-vite";
import { setupWorker } from "msw/browser";
import { mswLoader } from "msw-storybook-addon/csf3";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../src/context/AuthContext";
import i18n from "../src/i18n";
import { applyDirection } from "../src/i18n/direction";
import { defaultHandlers } from "../src/mocks/handlers";
// Same stylesheet order as src/main.tsx: theme.css overrides Bootstrap.
import "../src/bootstrap.css";
import "../src/theme.css";
import "../src/styles.css";

// Fake API (see src/mocks/handlers.ts). An /api call with no handler is a
// story bug -- warn loudly rather than letting it hit the network. Every
// non-API request (fonts, images, Vite modules) passes through untouched.
const msw = mswLoader(async () => {
  const worker = setupWorker();
  await worker.start({
    quiet: true,
    onUnhandledRequest(request, print) {
      if (new URL(request.url).pathname.startsWith("/api/")) print.warning();
    },
  });
  return worker;
});

const preview: Preview = {
  globalTypes: {
    locale: {
      description: "UI language (Hebrew also flips the page to right-to-left)",
      toolbar: {
        title: "Language",
        icon: "globe",
        items: [
          { value: "en", title: "English (LTR)" },
          { value: "he", title: "עברית (RTL)" },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    locale: "en",
  },

  // Guest checklist progress, material ticks and row counters live in
  // localStorage -- start every story from a clean device.
  beforeEach: () => {
    try {
      localStorage.clear();
    } catch {
      // Storage unavailable: nothing to reset.
    }
  },

  loaders: [
    // Switch language + direction before the story renders, the same way
    // main.tsx does at boot, so RTL stories never flash LTR first.
    async ({ globals }) => {
      const locale = (globals.locale as string) ?? "en";
      await i18n.changeLanguage(locale);
      applyDirection(locale);
      return {};
    },
    msw,
  ],

  decorators: [
    // The real AuthProvider: whether a story is logged in comes from the
    // fake GET /api/profile (handlers.loggedIn / loggedOut), so auth-aware
    // components behave exactly as they do in the app.
    (Story, { parameters }) => (
      <MemoryRouter initialEntries={[(parameters.route as string) ?? "/community"]}>
        <AuthProvider>
          <div className="p-3">
            <Story />
          </div>
        </AuthProvider>
      </MemoryRouter>
    ),
  ],

  parameters: {
    msw: { handlers: defaultHandlers },

    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },

    viewport: {
      options: {
        mobile: { name: "Mobile (375)", styles: { width: "375px", height: "812px" }, type: "mobile" },
        tablet: { name: "Tablet (768)", styles: { width: "768px", height: "1024px" }, type: "tablet" },
        desktop: { name: "Desktop (1280)", styles: { width: "1280px", height: "800px" }, type: "desktop" },
      },
    },

    a11y: {
      // Any axe violation fails the story's test (npm run test:stories and
      // CI). Don't loosen this globally -- switch off a specific rule on
      // the one story that needs it, with a comment saying why.
      test: "error",
    },
  },
};

export default preview;
