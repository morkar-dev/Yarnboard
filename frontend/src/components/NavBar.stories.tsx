import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
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
    await expect(await canvas.findByRole("link", { name: "Log in" })).toBeInTheDocument();
    await expect(canvas.queryByRole("link", { name: "My Uploads" })).not.toBeInTheDocument();
  },
};

export const LoggedIn: Story = {
  parameters: { msw: { handlers: { auth: loggedIn, inbox: inboxWith(fixtures.inbox) } } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("Hi, jane")).toBeInTheDocument();
    await expect(canvas.getByRole("link", { name: "My Uploads" })).toBeInTheDocument();
    await expect(canvas.queryByRole("link", { name: "Log in" })).not.toBeInTheDocument();
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
    await expect(await canvas.findByRole("link", { name: "Community" })).toBeVisible();
  },
};
