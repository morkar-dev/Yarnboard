/**
 * Applies everything a language change needs outside React's own render
 * cycle: <html dir/lang> (drives every CSS logical-property/flex-
 * direction flip across styles.css, plus screen-reader language) and
 * Bootstrap's RTL override (a separately-built stylesheet, not
 * something a CSS class or attribute alone can flip).
 *
 * The LTR Bootstrap build is a static import (src/bootstrap.css, in the
 * "bootstrap" cascade layer) and is never touched here; this only ever
 * adds or removes the RTL build. It joins the same "bootstrap" layer via
 * `@import ... layer(bootstrap)`: later in that layer than the LTR build,
 * so it overrides it, but still a layer, so the app's own unlayered
 * theme.css/styles.css keep winning over it. (A plain <link> appended
 * here used to beat theme.css too -- Hebrew pages came out in Bootstrap
 * blue.) Removing it on an LTR switch leaves the LTR build as the only
 * Bootstrap in effect again. The RTL build stays behind Vite's `?url`
 * suffix so it's only fetched when actually needed.
 *
 * Shared by the app (main.tsx: once before the first render, then on
 * every i18n "languageChanged" event) and Storybook (the language
 * toolbar switch), so both flip direction the exact same way.
 */
import bootstrapRtlHref from "bootstrap/dist/css/bootstrap.rtl.min.css?url";
import { isRtl } from "./index";

const BOOTSTRAP_RTL_STYLE_ID = "bootstrap-rtl-css";

export function applyDirection(language: string) {
  document.documentElement.dir = isRtl(language) ? "rtl" : "ltr";
  document.documentElement.lang = language;

  const rtlStyle = document.getElementById(BOOTSTRAP_RTL_STYLE_ID);

  if (isRtl(language)) {
    if (!rtlStyle) {
      const style = document.createElement("style");
      style.id = BOOTSTRAP_RTL_STYLE_ID;
      style.textContent = `@import url(${JSON.stringify(bootstrapRtlHref)}) layer(bootstrap);`;
      document.head.appendChild(style);
    }
  } else {
    rtlStyle?.remove();
  }
}
