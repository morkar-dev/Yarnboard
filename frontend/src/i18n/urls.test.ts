import { describe, expect, it } from "vitest";
import { languageFromPath, pathForLanguage, routerBasename, stripLanguagePrefix } from "./urls";

describe("language URLs", () => {
  it("reads the language from the /he prefix only", () => {
    expect(languageFromPath("/he")).toBe("he");
    expect(languageFromPath("/he/")).toBe("he");
    expect(languageFromPath("/he/pattern/8")).toBe("he");
    expect(languageFromPath("/")).toBe("en");
    expect(languageFromPath("/community")).toBe("en");
    // A path that merely starts with the letters "he" is not Hebrew.
    expect(languageFromPath("/hello")).toBe("en");
    expect(languageFromPath("/help/he")).toBe("en");
  });

  it("strips the prefix down to the router's path", () => {
    expect(stripLanguagePrefix("/he")).toBe("/");
    expect(stripLanguagePrefix("/he/mine")).toBe("/mine");
    expect(stripLanguagePrefix("/mine")).toBe("/mine");
    expect(stripLanguagePrefix("/hello")).toBe("/hello");
  });

  it("maps a page to the same page in the other language", () => {
    expect(pathForLanguage("/", "he")).toBe("/he");
    expect(pathForLanguage("/pattern/8", "he")).toBe("/he/pattern/8");
    expect(pathForLanguage("/he/pattern/8", "he")).toBe("/he/pattern/8");
    expect(pathForLanguage("/he/pattern/8", "en")).toBe("/pattern/8");
    expect(pathForLanguage("/he", "en")).toBe("/");
  });

  it("gives the router a /he basename on Hebrew pages", () => {
    expect(routerBasename("/he/community")).toBe("/he");
    expect(routerBasename("/community")).toBeUndefined();
  });
});
