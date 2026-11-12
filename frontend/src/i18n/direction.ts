/**
 * Applies everything a language change needs outside React's own render
 * cycle: <html dir/lang> (drives every CSS logical-property/flex-
 * direction flip across styles.css, plus screen-reader language) and
 * Bootstrap's RTL override (a separately-built stylesheet, not
 * something a CSS class or attribute alone can flip).
 *
 * The LTR Bootstrap build is a plain static import in main.tsx (and in
 * .storybook/preview.tsx) and is never touched here; this only ever
 * creates or removes the RTL override, appended at the end of <head> so
 * it wins the cascade over the LTR build for shared selectors while
 * active, and removing it on an LTR switch leaves the LTR build as the
 * only Bootstrap stylesheet in effect again. The RTL build stays behind
 * Vite's `?url` suffix so it's only fetched when actually needed.
 *
 * Shared by the app (main.tsx: once before the first render, then on
 * every i18n "languageChanged" event) and Storybook (the language
 * toolbar switch), so both flip direction the exact same way.
 */
import bootstrapRtlHref from "bootstrap/dist/css/bootstrap.rtl.min.css?url";
import { isRtl } from "./index";

const BOOTSTRAP_RTL_LINK_ID = "bootstrap-rtl-css";

export function applyDirection(language: string) {
  document.documentElement.dir = isRtl(language) ? "rtl" : "ltr";
  document.documentElement.lang = language;

  const rtlLink = document.getElementById(BOOTSTRAP_RTL_LINK_ID) as HTMLLinkElement | null;

  if (isRtl(language)) {
    if (!rtlLink) {
      const link = document.createElement("link");
      link.id = BOOTSTRAP_RTL_LINK_ID;
      link.rel = "stylesheet";
      link.href = bootstrapRtlHref;
      document.head.appendChild(link);
    }
  } else {
    rtlLink?.remove();
  }
}
