import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, waitFor } from "storybook/test";
import { t } from "../mocks/text";
import * as fixtures from "../mocks/fixtures";
import { loggedIn, sharesWith } from "../mocks/handlers";
import PatternVisibilityPanel from "./PatternVisibilityPanel";

const meta = {
  component: PatternVisibilityPanel,
  decorators: [(Story) => <div style={{ maxWidth: 560 }}><Story /></div>],
  args: { pattern: fixtures.pattern, onPatternChange: fn() },
  parameters: { msw: { handlers: { auth: loggedIn } } },
  // Unpublish and delete ask window.confirm first; accept it in tests.
  beforeEach: () => {
    const original = window.confirm;
    window.confirm = () => true;
    return () => {
      window.confirm = original;
    };
  },
} satisfies Meta<typeof PatternVisibilityPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PrivateWithShares: Story = {
  parameters: { msw: { handlers: { shares: sharesWith(fixtures.shares) } } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("sam")).toBeInTheDocument();
    await expect(canvas.getByText("lee")).toBeInTheDocument();
  },
};

export const PrivateNotShared: Story = {
  parameters: { msw: { handlers: { shares: sharesWith([]) } } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText(t("visibility.noShares"))).toBeInTheDocument();
  },
};

export const Public: Story = {
  args: { pattern: { ...fixtures.pattern, is_public: true } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("button", { name: t("visibility.unpublishButton") })).toBeInTheDocument();
    await expect(canvas.queryByText(t("visibility.sharedWithHeading"))).not.toBeInTheDocument();
  },
};

export const PublishNeedsConsent: Story = {
  parameters: { msw: { handlers: { shares: sharesWith([]) } } },
  play: async ({ canvas, userEvent, args }) => {
    await userEvent.click(canvas.getByRole("button", { name: t("visibility.publishButton") }));
    const confirm = canvas.getByRole("button", { name: t("publishConsent.confirmButton") });
    await expect(confirm).toBeDisabled();
    await userEvent.click(canvas.getByLabelText(t("publishConsent.checkboxLabel")));
    await userEvent.click(confirm);
    await waitFor(() =>
      expect(args.onPatternChange).toHaveBeenCalledWith(expect.objectContaining({ is_public: true })),
    );
  },
};

export const ShareAsEditorAndToggle: Story = {
  parameters: { msw: { handlers: { shares: sharesWith([]) } } },
  play: async ({ canvas, userEvent }) => {
    await canvas.findByText(t("visibility.noShares"));
    await userEvent.type(canvas.getByPlaceholderText(t("visibility.shareUsernamePlaceholder")), "robin");
    await userEvent.click(canvas.getByLabelText(t("visibility.shareAsEditor")));
    await userEvent.click(canvas.getByRole("button", { name: t("visibility.shareButton") }));
    const canEdit = await canvas.findByLabelText(t("visibility.canEdit"));
    await expect(canEdit).toBeChecked();
    await userEvent.click(canEdit);
    await waitFor(() => expect(canEdit).not.toBeChecked());
    await userEvent.click(canvas.getByRole("button", { name: t("visibility.removeShare") }));
    await expect(await canvas.findByText(t("visibility.noShares"))).toBeInTheDocument();
  },
};

export const ShareWithUnknownUser: Story = {
  parameters: { msw: { handlers: { shares: sharesWith([]) } } },
  play: async ({ canvas, userEvent }) => {
    await canvas.findByText(t("visibility.noShares"));
    await userEvent.type(canvas.getByPlaceholderText(t("visibility.shareUsernamePlaceholder")), "nobody");
    await userEvent.click(canvas.getByRole("button", { name: t("visibility.shareButton") }));
    await expect(await canvas.findByRole("alert")).toBeVisible();
  },
};

export const Hebrew: Story = {
  globals: { locale: "he" },
  parameters: { msw: { handlers: { shares: sharesWith(fixtures.shares) } } },
};
