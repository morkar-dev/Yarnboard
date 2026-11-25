import { Fragment, type ReactNode } from "react";

/**
 * Renders a product update's plain-text body the same way the newsletter
 * email does (backend/app/email.py's render_newsletter_body): blank lines
 * split paragraphs, single newlines are line breaks, and http(s) URLs
 * become links. Built as React elements, never as HTML, so nothing in the
 * text can inject markup.
 */
const URL_PATTERN = /(https?:\/\/[^\s<>"]+)/g;
// Trailing punctuation belongs to the sentence, not the link.
const TRAILING = /[.,;:!?)\]}'"]+$/;

function linkify(line: string, keyPrefix: string): ReactNode[] {
  return line.split(URL_PATTERN).map((part, i) => {
    if (i % 2 === 0) return part;
    const trailing = part.match(TRAILING)?.[0] ?? "";
    const url = trailing ? part.slice(0, -trailing.length) : part;
    return (
      <Fragment key={`${keyPrefix}-${i}`}>
        <a href={url} target="_blank" rel="noopener noreferrer">
          {url}
        </a>
        {trailing}
      </Fragment>
    );
  });
}

export function renderUpdateBody(text: string): ReactNode[] {
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph, p) => (
      <p key={p} dir="auto">
        {paragraph.split("\n").map((line, l) => (
          <Fragment key={l}>
            {l > 0 && <br />}
            {linkify(line, `${p}-${l}`)}
          </Fragment>
        ))}
      </p>
    ));
}
