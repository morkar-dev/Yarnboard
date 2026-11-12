import type { Meta, StoryObj } from "@storybook/react-vite";
import { Route, Routes, useLocation } from "react-router-dom";
import { expect } from "storybook/test";
import { t } from "../mocks/text";
import { linkPreviewBlocked, linkPreviewDuplicate, loggedIn, loggedOut } from "../mocks/handlers";
import SubmitPatternPage from "./SubmitPatternPage";

/** Mounted under its real route, plus a stand-in for where a successful
 * preview navigates (the review page), so the play test can see it land. */
function AtRoute() {
  return (
    <Routes>
      <Route path="/submit" element={<SubmitPatternPage />} />
      <Route path="*" element={<Landed />} />
    </Routes>
  );
}

function Landed() {
  return <p data-testid="landed">Navigated to {useLocation().pathname}</p>;
}

const meta = {
  title: "Pages/SubmitPatternPage",
  component: AtRoute,
  parameters: { route: "/submit", msw: { handlers: { auth: loggedIn } } },
} satisfies Meta<typeof AtRoute>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FromALink: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(await canvas.findByLabelText(t("submit.urlLabel")), "https://example.com/cozy-raglan");
    await userEvent.click(canvas.getByRole("button", { name: t("submit.previewButton") }));
    await expect(await canvas.findByTestId("landed")).toHaveTextContent("/submit/review");
  },
};

export const LinkBlockedBySite: Story = {
  parameters: { msw: { handlers: { linkPreview: linkPreviewBlocked } } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(await canvas.findByLabelText(t("submit.urlLabel")), "https://example.com/blocked");
    await userEvent.click(canvas.getByRole("button", { name: t("submit.previewButton") }));
    await expect(await canvas.findByText(t("submit.fetchFailedTitle"))).toBeVisible();
  },
};

export const DuplicateLink: Story = {
  parameters: { msw: { handlers: { linkPreview: linkPreviewDuplicate } } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(await canvas.findByLabelText(t("submit.urlLabel")), "https://example.com/already-here");
    await userEvent.click(canvas.getByRole("button", { name: t("submit.previewButton") }));
    await expect(await canvas.findByTestId("landed")).toHaveTextContent("/pattern/43");
  },
};

export const SwitchModes: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: t("submit.modeText") }));
    await expect(canvas.getByLabelText(t("submit.textLabel"))).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: t("submit.modePhotos") }));
    await expect(canvas.getByLabelText(t("submit.photosLabel"))).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: t("submit.modeUpload") }));
    await expect(canvas.getByLabelText(t("submit.uploadFileLabel"))).toBeInTheDocument();
  },
};

export const Guest: Story = {
  parameters: { msw: { handlers: { auth: loggedOut } } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("link", { name: t("submit.guestPromptLogin") })).toBeInTheDocument();
    await expect(canvas.queryByLabelText(t("submit.urlLabel"))).not.toBeInTheDocument();
  },
};

export const Hebrew: Story = { globals: { locale: "he" } };

export const Mobile: Story = { globals: { viewport: { value: "mobile", isRotated: false } } };
