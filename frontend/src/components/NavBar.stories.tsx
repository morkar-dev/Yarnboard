import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { t } from "../mocks/text";
import * as fixtures from "../mocks/fixtures";
import { inboxWith, loggedIn } from "../mocks/handlers";
import NavBar from "./NavBar";

const meta = {
  component: NavBar,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof NavBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Guest: Story = {
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("link", { name: t("nav.login") })).toBeInTheDocument();
    await expect(canvas.queryByRole("link", { name: t("nav.myUploads") })).not.toBeInTheDocument();
  },
};

export const LoggedIn: Story = {
  parameters: { msw: { handlers: { auth: loggedIn, inbox: inboxWith(fixtures.inbox) } } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText(t("nav.greeting", { username: "jane" }))).toBeInTheDocument();
    await expect(canvas.getByRole("link", { name: t("nav.myUploads") })).toBeInTheDocument();
    await expect(canvas.queryByRole("link", { name: t("nav.login") })).not.toBeInTheDocument();
  },
};

export const HomePage: Story = {
  parameters: { route: "/" },
};

export const MobileCollapsed: Story = {
  globals: { viewport: { value: "mobile", isRotated: false } },
  play: async ({ canvas, userEvent }) => {
    const toggle = canvas.getByRole("button", { name: /toggle navigation/i });
    await userEvent.click(toggle);
    await expect(await canvas.findByRole("link", { name: t("nav.community") })).toBeVisible();
  },
};
