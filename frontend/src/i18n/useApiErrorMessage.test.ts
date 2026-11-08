import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { ApiError } from "../api/client";
import { useApiErrorMessage } from "./useApiErrorMessage";

function getMessage(err: unknown) {
  const { result } = renderHook(() => useApiErrorMessage());
  return result.current(err, "Fallback text");
}

describe("useApiErrorMessage", () => {
  it("uses the fallback for a server error page with no code", () => {
    // e.g. gunicorn killing a slow scrape: bare HTML, so only statusText.
    expect(getMessage(new ApiError(500, "Internal Server Error"))).toBe("Fallback text");
    expect(getMessage(new ApiError(502, "Bad Gateway"))).toBe("Fallback text");
  });

  it("translates a coded server error", () => {
    expect(getMessage(new ApiError(502, "https://x.test returned HTTP 404", "scraper_error"))).toBe(
      "We couldn't read that page automatically.",
    );
  });

  it("keeps the server's own message for a coded error with no translation", () => {
    expect(getMessage(new ApiError(400, "Not a chart link", "invalid_share_url"))).toBe(
      "Not a chart link",
    );
  });

  it("shows a fixed message for translation_error, not the server text", () => {
    expect(getMessage(new ApiError(502, "Gemini quota exceeded", "translation_error"))).toBe(
      "We couldn't translate this pattern right now. Please try again in a moment.",
    );
  });

  it("keeps the message for a 4xx with no code", () => {
    expect(getMessage(new ApiError(400, "Bad request text"))).toBe("Bad request text");
  });

  it("uses the fallback for non-API errors", () => {
    expect(getMessage(new TypeError("Failed to fetch"))).toBe("Fallback text");
  });
});
