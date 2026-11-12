import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./context/AuthContext";
import i18n, { getStoredLanguage } from "./i18n";
import { applyDirection } from "./i18n/direction";
// Bootstrap sits in a cascade layer (see bootstrap.css), so theme.css and
// styles.css override it whatever the load order -- including the RTL
// build added later for Hebrew. The LTR build is a plain static import (like theme.css/styles.css below) so
// Vite emits a real <link> for it straight into the built page's
// <head>, fetched in parallel with the JS bundle from the start --
// unlike the old fully-JS-managed version, where the browser couldn't
// even start that request until this module had already loaded and run,
// which is what Lighthouse flagged as the cause of a large layout shift
// (the page painted once, unstyled, then again once Bootstrap's CSS
// finally arrived). The RTL build stays behind Vite's `?url` suffix and
// is only ever added via JS (see i18n/direction.ts) for a returning
// Hebrew-preferring visitor -- not worth paying the same eager-load cost
// for the uncommon case.
import "./bootstrap.css";
import "./theme.css";
import "./styles.css";

applyDirection(getStoredLanguage());
i18n.on("languageChanged", applyDirection);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
