import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import AttributionTag from "./AttributionTag";
import type { Pattern } from "../types/models";

const basePattern: Pattern = {
  id: 1,
  original_url: "https://example.com/my-pattern",
  has_source_link: true,
  title: "Cozy Beanie",
  author: "Jane Designer",
  source_site_name: "Wooly Blog",
  source_domain: "woolyblog.example.com",
  materials: null,
  abbreviations: null,
  instructions: {},
  photo_url: null,
  has_photo: false,
  chart_grid: null,
  translations: { he: null },
  uploader: "knitter123",
  uploader_id: 2,
  is_public: true,
  can_edit: false,
  can_manage: false,
  created_at: null,
};

describe("AttributionTag", () => {
  it("shows the uploader and the original author/site", () => {
    render(<AttributionTag pattern={basePattern} />);

    expect(screen.getByText("knitter123")).toBeInTheDocument();
    expect(screen.getByText("Jane Designer")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Wooly Blog" });
    expect(link).toHaveAttribute("href", "https://example.com/my-pattern");
  });

  it("falls back to source_domain when source_site_name is missing", () => {
    render(<AttributionTag pattern={{ ...basePattern, source_site_name: null }} />);

    expect(screen.getByRole("link", { name: "woolyblog.example.com" })).toBeInTheDocument();
  });

  it("falls back to a generic label when neither site field is set", () => {
    render(
      <AttributionTag pattern={{ ...basePattern, source_site_name: null, source_domain: null }} />,
    );

    expect(screen.getByRole("link", { name: "the original site" })).toBeInTheDocument();
  });

  it("never renders a non-http source as a link", () => {
    render(
      <AttributionTag pattern={{ ...basePattern, original_url: "javascript:alert(1)" }} />,
    );

    expect(screen.getByText("Wooly Blog")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("has no source link for a pattern added from text or photos", () => {
    render(
      <AttributionTag
        pattern={{ ...basePattern, has_source_link: false, original_url: "manual:1234" }}
      />,
    );

    expect(screen.getByText("Jane Designer")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("drops the author line entirely when there's neither a link nor an author", () => {
    render(<AttributionTag pattern={{ ...basePattern, has_source_link: false, author: null }} />);

    expect(screen.queryByText("Unknown")).toBeNull();
    expect(screen.getByText("knitter123")).toBeInTheDocument();
  });

  it("shows Unknown when there's no author on record", () => {
    render(<AttributionTag pattern={{ ...basePattern, author: null }} />);

    expect(screen.getByText("Unknown")).toBeInTheDocument();
  });
});
