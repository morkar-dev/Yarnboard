import type { Meta, StoryObj } from "@storybook/react-vite";
import { Route, Routes, useLocation } from "react-router-dom";
import { expect } from "storybook/test";
import { t } from "../mocks/text";
import * as fixtures from "../mocks/fixtures";
import { loggedIn, patternIs, patternNotFound, saveEditFails } from "../mocks/handlers";
import EditPatternPage from "./EditPatternPage";

function AtRoute() {
  return (
    <Routes>
      <Route path="/pattern/:id/edit" element={<EditPatternPage />} />
      <Route path="*" element={<Landed />} />
    </Routes>
  );
}

function Landed() {
  return <p data-testid="landed">Navigated to {useLocation().pathname}</p>;
}

const withHebrew = { ...fixtures.pattern, translations: { en: null, he: fixtures.hebrewTranslation } };

const meta = {
  title: "Pages/EditPatternPage",
  component: AtRoute,
  parameters: { route: "/pattern/42/edit", msw: { handlers: { auth: loggedIn } } },
} satisfies Meta<typeof AtRoute>;

export default meta;
type Story = StoryObj<typeof meta>;

export const EditAndSave: Story = {
  play: async ({ canvas, userEvent }) => {
    const title = await canvas.findByLabelText(t("reviewForm.titleLabel"));
    await userEvent.clear(title);
    await userEvent.type(title, "Cozy Raglan, revised");
    await userEvent.click(canvas.getByRole("button", { name: t("editPattern.saveButton") }));
    await expect(await canvas.findByTestId("landed")).toHaveTextContent("/pattern/42");
  },
};

export const WithHebrewTranslation: Story = {
  parameters: { msw: { handlers: { pattern: patternIs(withHebrew) } } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("heading", { name: t("editPattern.translationHeadingHe") })).toBeInTheDocument();
  },
};

export const SaveFails: Story = {
  parameters: { msw: { handlers: { pattern: patternIs(withHebrew), saveEdit: saveEditFails } } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: t("editPattern.saveButton") }));
    await expect(await canvas.findByRole("alert")).toBeVisible();
  },
};

export const NoPermission: Story = {
  parameters: { msw: { handlers: { pattern: patternIs(fixtures.sharedViewOnlyPattern) } } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText(t("editPattern.permissionDenied"))).toBeInTheDocument();
  },
};

export const NotFound: Story = {
  parameters: { msw: { handlers: { pattern: patternNotFound } } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText(t("editPattern.notFound"))).toBeInTheDocument();
  },
};

export const Hebrew: Story = {
  globals: { locale: "he" },
  parameters: { msw: { handlers: { pattern: patternIs(withHebrew) } } },
};

export const Mobile: Story = { globals: { viewport: { value: "mobile", isRotated: false } } };
