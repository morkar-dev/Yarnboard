/**
 * Cloudflare Worker in front of the built frontend's static assets.
 *
 * Its only job is to proxy /api/* to the Render backend, so the browser
 * sees the API on the same origin as the page (yarnboard.net) instead of
 * calling yarnboard.onrender.com directly. That matters because the
 * Flask session cookie set by a cross-site API is a *third-party* cookie,
 * and Safari (every browser on iOS, since they're all WebKit) blocks
 * third-party cookies outright, SameSite=None or not -- login "succeeds"
 * but the cookie is dropped, so every following call (GET /api/profile)
 * comes back 401. Proxied, the Set-Cookie arrives on yarnboard.net's own
 * response and is a plain first-party cookie.
 *
 * Proxying also fixes the 405s: without this Worker, a relative
 * POST /api/... against the Cloudflare domain hit the static-asset
 * handler, which only answers GET/HEAD.
 *
 * wrangler.jsonc's `run_worker_first: ["/api/*"]` means this script only
 * runs for API paths; everything else is served straight from assets
 * (with the SPA index.html fallback) without invoking it at all.
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    const upstream = new URL(url.pathname + url.search, env.API_ORIGIN);
    const headers = new Headers(request.headers);
    headers.set("X-Forwarded-Host", url.host);
    headers.set("X-Forwarded-Proto", url.protocol.replace(":", ""));
    // Same-origin now, so CORS no longer applies -- drop Origin so Flask-CORS
    // doesn't reject the request just because the proxy's origin isn't in
    // CORS_ORIGINS.
    headers.delete("Origin");

    return fetch(upstream, {
      method: request.method,
      headers,
      body: request.body,
      redirect: "manual",
    });
  },
};
