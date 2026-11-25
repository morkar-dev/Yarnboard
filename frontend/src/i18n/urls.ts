/**
 * The page's language comes from its URL: /he/... is Hebrew, everything
 * else English. That gives search engines and link previews a separate,
 * crawlable Hebrew version of every page (worker/index.js adds the
 * matching lang/dir, hreflang and Hebrew meta tags server-side).
 *
 * The app itself stays prefix-free: main.tsx gives the router basename
 * "/he" on Hebrew URLs, so every <Link to="/community"> and
 * navigate("/mine") keeps the visitor in their language without knowing
 * about it. Switching language is a full page load to the other URL (see
 * NavBar's toggle).
 */
export type UrlLanguage = "en" | "he";

export const HEBREW_PREFIX = "/he";
const HEBREW_PATH = /^\/he(?=\/|$)/;

export function languageFromPath(pathname: string): UrlLanguage {
  return HEBREW_PATH.test(pathname) ? "he" : "en";
}

/** "/he/community" -> "/community", "/he" -> "/", others unchanged. */
export function stripLanguagePrefix(pathname: string): string {
  return pathname.replace(HEBREW_PATH, "") || "/";
}

/** The same page in `language`: "/community" <-> "/he/community". */
export function pathForLanguage(pathname: string, language: UrlLanguage): string {
  const bare = stripLanguagePrefix(pathname);
  if (language === "en") return bare;
  return bare === "/" ? HEBREW_PREFIX : HEBREW_PREFIX + bare;
}

export function routerBasename(pathname: string): string | undefined {
  return languageFromPath(pathname) === "he" ? HEBREW_PREFIX : undefined;
}
