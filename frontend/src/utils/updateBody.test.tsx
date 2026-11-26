import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderUpdateBody } from "./updateBody";

function html(text: string) {
  const { container } = render(<div>{renderUpdateBody(text)}</div>);
  return container.firstElementChild!.innerHTML;
}

describe("renderUpdateBody", () => {
  it("splits paragraphs on blank lines and keeps single line breaks", () => {
    expect(html("New this week!\nPhotos work again.\n\nEnjoy")).toBe(
      '<p dir="auto">New this week!<br>Photos work again.</p><p dir="auto">Enjoy</p>',
    );
  });

  it("links http(s) URLs, leaving trailing punctuation outside the link", () => {
    const out = html("See https://www.yarnboard.net/community.");
    expect(out).toContain('<a href="https://www.yarnboard.net/community" target="_blank" rel="noopener noreferrer">');
    expect(out).toContain("</a>.");
  });

  it("never turns text into markup", () => {
    const out = html('<img src=x onerror=alert(1)> javascript:alert(1)');
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
    expect(out).not.toContain("<a");
  });
});
