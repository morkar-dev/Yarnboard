import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, waitFor } from "storybook/test";
import { t } from "../mocks/text";
import { previewFails } from "../mocks/handlers";
import PhotoPatternForm from "./PhotoPatternForm";

/** A real (tiny) PNG, so resizeImage can actually decode it in the browser. */
async function photo(name: string, color: string): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 48;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 64, 48);
  const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), "image/png"));
  return new File([blob], name, { type: "image/png" });
}

const meta = {
  component: PhotoPatternForm,
  args: { onResult: fn() },
} satisfies Meta<typeof PhotoPatternForm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("button", { name: t("submit.photosButton") })).toBeDisabled();
  },
};

export const AddRemoveAndSubmit: Story = {
  play: async ({ canvas, userEvent, args }) => {
    const input = canvas.getByLabelText(t("submit.photosLabel"));
    await userEvent.upload(input, [await photo("page1.png", "#6b3f73"), await photo("page2.png", "#9b6fa3")]);
    await expect(canvas.getByAltText(t("submit.photoAlt", { number: 1 }))).toBeInTheDocument();
    await expect(canvas.getByAltText(t("submit.photoAlt", { number: 2 }))).toBeInTheDocument();

    await userEvent.click(canvas.getByRole("button", { name: t("submit.removePhoto", { number: 2 }) }));
    await expect(canvas.queryByAltText(t("submit.photoAlt", { number: 2 }))).not.toBeInTheDocument();

    await userEvent.click(canvas.getByRole("button", { name: t("submit.photosButton") }));
    await waitFor(() => expect(args.onResult).toHaveBeenCalledTimes(1));
  },
};

export const TooManyPhotos: Story = {
  play: async ({ canvas, userEvent }) => {
    const files = await Promise.all(["#111", "#333", "#555", "#777", "#999", "#bbb"].map((c, i) => photo(`p${i}.png`, c)));
    await userEvent.upload(canvas.getByLabelText(t("submit.photosLabel")), files);
    await expect(canvas.getByText(t("submit.photosTooMany", { max: 5 }))).toBeVisible();
    await expect(canvas.getByLabelText(t("submit.photosLabel"))).toBeDisabled();
  },
};

export const ServerCantReadThem: Story = {
  parameters: { msw: { handlers: { preview: previewFails } } },
  play: async ({ canvas, userEvent, args }) => {
    await userEvent.upload(canvas.getByLabelText(t("submit.photosLabel")), await photo("blurry.png", "#ccc"));
    await userEvent.click(canvas.getByRole("button", { name: t("submit.photosButton") }));
    await expect(await canvas.findByRole("alert")).toBeVisible();
    await expect(args.onResult).not.toHaveBeenCalled();
  },
};
