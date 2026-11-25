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
 * The backend rate-limits per client IP, but every proxied request reaches
 * Render from a Cloudflare address -- so the visitor's real IP
 * (CF-Connecting-IP, set by Cloudflare and not forgeable by the client)
 * goes along as X-Yarnboard-Client-IP, together with PROXY_SHARED_SECRET
 * (a `wrangler secret`) proving the header came from this Worker. See
 * client_ip() in backend/app/extensions.py.
 *
 * Proxying also fixes the 405s: without this Worker, a relative
 * POST /api/... against the Cloudflare domain hit the static-asset
 * handler, which only answers GET/HEAD.
 *
 * Its second job is link previews. Facebook, WhatsApp, X, Slack and the
 * like don't run JavaScript, so without help every shared /pattern/<id>
 * link would show the site-wide preview from index.html. When one of their
 * crawlers asks for a *public* pattern, patternPreview swaps in that
 * pattern's own title, description and photo. Real visitors are never
 * delayed by this: they get index.html untouched.
 *
 * wrangler.jsonc's `run_worker_first: ["/api/*", "/pattern/*"]` means this
 * script only runs for those paths; everything else is served straight
 * from assets (with the SPA index.html fallback) without invoking it.
 */

// Link-preview and search crawlers. Matching is only an optimization (who
// gets the extra API call); a false match still gets a correct page.
const PREVIEW_BOT =
  /facebookexternalhit|facebot|twitterbot|whatsapp|slackbot|linkedinbot|telegrambot|discordbot|pinterest|redditbot|applebot|googlebot|bingbot|duckduckbot|yandex|embedly|skypeuripreview|vkshare|mastodon|bluesky|iframely/i;
const PATTERN_PAGE = /^\/pattern\/(\d+)\/?$/;
// A sleeping Render instance takes far longer than this to wake; the
// crawler then gets the plain page rather than waiting on it.
const PREVIEW_API_TIMEOUT_MS = 5000;
const DESCRIPTION_MAX = 200;

function apiHeaders(request, env) {
  const headers = new Headers(request.headers);
  // Same-origin now, so CORS no longer applies -- drop Origin so Flask-CORS
  // doesn't reject the request just because the proxy's origin isn't in
  // CORS_ORIGINS.
  headers.delete("Origin");
  // Never pass through a client-supplied copy of our own headers.
  headers.delete("X-Yarnboard-Client-IP");
  headers.delete("X-Yarnboard-Proxy-Secret");
  const clientIp = request.headers.get("CF-Connecting-IP");
  if (clientIp && env.PROXY_SHARED_SECRET) {
    headers.set("X-Yarnboard-Client-IP", clientIp);
    headers.set("X-Yarnboard-Proxy-Secret", env.PROXY_SHARED_SECRET);
  }
  return headers;
}

function shorten(text, max) {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

function describe(pattern) {
  const by = [pattern.author && `by ${pattern.author}`, pattern.source_site_name && `from ${pattern.source_site_name}`]
    .filter(Boolean)
    .join(" ");
  const intro = `A knitting & crochet pattern${by ? ` ${by}` : ""}, organized on Yarnboard.`;
  const items = (pattern.materials || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const materials = items.length ? ` Materials: ${items.join(", ")}.` : "";
  return shorten(intro + materials, DESCRIPTION_MAX);
}

/** Only https images make it into a preview; a relative photo_url is our
 * own uploaded-photo route. */
function absolutePhoto(photoUrl, origin) {
  if (!photoUrl) return null;
  if (photoUrl.startsWith("/")) return origin + photoUrl;
  return photoUrl.startsWith("https://") ? photoUrl : null;
}

/** index.html with a public pattern's own preview tags, or null to serve
 * the page as-is (not a crawler, not public, API asleep or failing). */
async function patternPreview(request, env, url) {
  const match = url.pathname.match(PATTERN_PAGE);
  if (!match || request.method !== "GET" || !PREVIEW_BOT.test(request.headers.get("User-Agent") || "")) {
    return null;
  }

  let pattern;
  try {
    // No cookies: the API answers as a logged-out guest, so only public
    // patterns come back (private ones 404).
    const headers = apiHeaders(request, env);
    headers.delete("Cookie");
    headers.set("Accept", "application/json");
    const response = await fetch(new URL(`/api/patterns/${match[1]}`, env.API_ORIGIN), {
      headers,
      signal: AbortSignal.timeout(PREVIEW_API_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    pattern = await response.json();
  } catch {
    return null;
  }
  if (!pattern?.title) return null;

  const page = await env.ASSETS.fetch(request);
  if (!page.ok) return null;

  const pageUrl = `${url.origin}/pattern/${pattern.id}`;
  const title = `${shorten(pattern.title, 70)} | Yarnboard`;
  const description = describe(pattern);
  const image = absolutePhoto(pattern.photo_url, url.origin);

  const tags = [
    ["meta", { property: "og:type", content: "article" }],
    ["meta", { property: "og:site_name", content: "Yarnboard" }],
    ["meta", { property: "og:title", content: title }],
    ["meta", { property: "og:description", content: description }],
    ["meta", { property: "og:url", content: pageUrl }],
    ["meta", { name: "description", content: description }],
    ["meta", { name: "twitter:card", content: image ? "summary_large_image" : "summary" }],
    ["link", { rel: "canonical", href: pageUrl }],
  ];
  if (image) {
    tags.push(["meta", { property: "og:image", content: image }]);
    tags.push(["meta", { property: "og:image:alt", content: pattern.title }]);
  }
  const escape = (value) =>
    String(value).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const markup = tags
    .map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${escape(v)}"`).join(" ")} />`)
    .join("\n    ");

  const remove = { element: (el) => el.remove() };
  return new HTMLRewriter()
    .on('meta[property^="og:"]', remove)
    .on('meta[name^="twitter:"]', remove)
    .on('meta[name="description"]', remove)
    .on('link[rel="canonical"]', remove)
    .on("title", { element: (el) => el.setInnerContent(title) })
    .on("head", { element: (el) => el.append(`    ${markup}\n  `, { html: true }) })
    .transform(page);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/api/")) {
      return (await patternPreview(request, env, url)) ?? env.ASSETS.fetch(request);
    }

    const upstream = new URL(url.pathname + url.search, env.API_ORIGIN);
    const headers = apiHeaders(request, env);
    headers.set("X-Forwarded-Host", url.host);
    headers.set("X-Forwarded-Proto", url.protocol.replace(":", ""));

    return fetch(upstream, {
      method: request.method,
      headers,
      body: request.body,
      redirect: "manual",
    });
  },
};
