import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { t } from "../mocks/text";
import * as fixtures from "../mocks/fixtures";
import AttributionTag from "./AttributionTag";

const meta = {
  component: AttributionTag,
  args: { pattern: fixtures.pattern },
} satisfies Meta<typeof AttributionTag>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithSourceLink: Story = {
  play: async ({ canvas }) => {
    const link = canvas.getByRole("link", { name: "Example Knits" });
    await expect(link).toHaveAttribute("href", fixtures.pattern.original_url);
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  },
};

export const UnknownAuthorAndSite: Story = {
  args: { pattern: { ...fixtures.pattern, author: null, source_site_name: null, source_domain: null } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(t("attribution.unknownAuthor"))).toBeInTheDocument();
    await expect(canvas.getByRole("link", { name: t("attribution.originalSiteFallback") })).toBeInTheDocument();
  },
};

export const NoSourceLink: Story = {
  args: { pattern: fixtures.manualPattern },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole("link")).not.toBeInTheDocument();
  },
};
