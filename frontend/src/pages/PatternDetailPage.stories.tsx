import type { Meta, StoryObj } from "@storybook/react-vite";
import { Route, Routes } from "react-router-dom";
import { expect, waitFor } from "storybook/test";
import * as fixtures from "../mocks/fixtures";
import {
  loggedIn,
  loggedOut,
  patternIs,
  patternLoading,
  patternNotFound,
  sharesWith,
  translateFails,
} from "../mocks/handlers";
import PatternDetailPage from "./PatternDetailPage";

/** The page reads :id from the URL, so mount it under its real route. */
function AtRoute() {
  return (
    <Routes>
      <Route path="/pattern/:id" element={<PatternDetailPage />} />
    </Routes>
  );
}

const meta = {
  title: "Pages/PatternDetailPage",
  component: AtRoute,
  parameters: {
    route: "/pattern/42",
    msw: { handlers: { auth: loggedIn, shares: sharesWith(fixtures.shares) } },
  },
} satisfies Meta<typeof AtRoute>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Owner: Story = {
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("heading", { name: "Cozy Raglan Sweater" })).toBeInTheDocument();
    await expect(canvas.getByRole("link", { name: "Edit" })).toHaveAttribute("href", "/pattern/42/edit");
    await expect(canvas.getByRole("button", { name: "Publish to Community" })).toBeInTheDocument();
  },
};

export const SharedViewOnly: Story = {
  parameters: { msw: { handlers: { pattern: patternIs(fixtures.sharedViewOnlyPattern) } } },
  play: async ({ canvas }) => {
    await canvas.findByRole("heading", { name: "Cozy Raglan Sweater" });
    await expect(canvas.queryByRole("link", { name: "Edit" })).not.toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: "Publish to Community" })).not.toBeInTheDocument();
  },
};

export const GuestViewingPublicPattern: Story = {
  parameters: {
    msw: { handlers: { auth: loggedOut, pattern: patternIs({ ...fixtures.publicPattern, can_edit: false, can_manage: false }) } },
  },
  play: async ({ canvas }) => {
    await canvas.findByRole("heading", { name: "Simple Garter Scarf" });
    await expect(canvas.queryByRole("button", { name: "Translate to Hebrew" })).not.toBeInTheDocument();
    await expect(await canvas.findByText(/checking items off as a guest/)).toBeInTheDocument();
  },
};

export const TranslateToHebrew: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "Translate to Hebrew" }));
    // English UI keeps the English content; the button goes away once a
    // Hebrew translation exists.
    await waitFor(() =>
      expect(canvas.queryByRole("button", { name: "Translate to Hebrew" })).not.toBeInTheDocument(),
    );
  },
};

export const TranslationFails: Story = {
  parameters: { msw: { handlers: { translate: translateFails } } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "Translate to Hebrew" }));
    await expect(await canvas.findByRole("alert")).toBeVisible();
  },
};

export const HebrewUiWithUnreviewedTranslation: Story = {
  globals: { locale: "he" },
  parameters: {
    msw: {
      handlers: {
        pattern: patternIs({ ...fixtures.pattern, translations: { en: null, he: fixtures.hebrewTranslation } }),
      },
    },
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("heading", { name: "סוודר רגלן נעים" })).toBeInTheDocument();
    await expect(canvas.getByRole("alert")).toBeVisible();
  },
};

export const WithChart: Story = {
  parameters: {
    msw: {
      handlers: {
        pattern: patternIs({
          ...fixtures.pattern,
          chart_grid: {
            column_count: 24,
            row_count: 10,
            palette: [{ hex: "#f4ecf6", label: "Background" }, { hex: "#6b3f73", label: "Eggplant" }],
            cells: Array.from({ length: 240 }, (_, i) => ((i % 24) + Math.floor(i / 24)) % 4 === 0 ? 1 : 0),
          },
        }),
      },
    },
  },
};

export const Loading: Story = { parameters: { msw: { handlers: { pattern: patternLoading } } } };

export const NotFound: Story = {
  parameters: { msw: { handlers: { pattern: patternNotFound } } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("Pattern not found.")).toBeInTheDocument();
  },
};

export const Mobile: Story = { globals: { viewport: { value: "mobile", isRotated: false } } };
