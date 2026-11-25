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
 * Its second job is each page's <head> (servePage). The app is a
 * single-page app with one index.html, but search engines and link
 * previews need per-URL tags: the page's language (/he/... is Hebrew, see
 * frontend/src/i18n/urls.ts), its canonical URL, hreflang links between
 * the English and Hebrew versions, and a title/description in that
 * language. Facebook, WhatsApp, X, Slack and the like don't run
 * JavaScript, so for their crawlers a public pattern's page also gets
 * that pattern's own title, description and photo. Real visitors are
 * never delayed by an API call for this.
 *
 * wrangler.jsonc's `run_worker_first: ["/*", "!/assets/*"]` sends every
 * request except the built JS/CSS through this script; anything that
 * isn't an HTML page (robots.txt, images, ...) passes through unchanged.
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

// The site-wide title and description, per language. English matches
// frontend/index.html; /he pages get the Hebrew ones.
const SITE = {
  en: {
    title: "Yarnboard | Knitting & Crochet Patterns Organized Tracker",
    description:
      "Organize knitting & crochet patterns from URLs, PDFs & Stitch Fiddle into a to-do list. Keep private, share, or post free patterns to the community.",
    imageAlt: "Yarnboard: knitting & crochet patterns, organized",
    locale: "en_US",
  },
  he: {
    title: "Yarnboard | מארגן דוגמיות סריגה וקרושה",
    description:
      "ארגנו דוגמיות סריגה וקרושה מקישורים, מקובצי PDF ומ-Stitch Fiddle לרשימת משימות. שמרו לעצמכם, שתפו, או פרסמו דוגמיות חינמיות לקהילה.",
    imageAlt: "Yarnboard: דוגמיות סריגה וקרושה, מסודרות",
    locale: "he_IL",
  },
};
// Same rule as frontend/src/i18n/urls.ts: /he and /he/... are Hebrew.
const HEBREW_PATH = /^\/he(?=\/|$)/;

/** { language, bare }: the page's language and its path without the /he
 * prefix or a trailing slash ("/he/community/" -> he, "/community"). */
function pageLanguage(pathname) {
  const language = HEBREW_PATH.test(pathname) ? "he" : "en";
  const bare = pathname.replace(HEBREW_PATH, "").replace(/\/+$/, "") || "/";
  return { language, bare };
}

function pathFor(bare, language) {
  if (language === "en") return bare;
  return bare === "/" ? "/he" : `/he${bare}`;
}

function shorten(text, max) {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

function materialsList(text) {
  return (text || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(", ");
}

function describe(pattern, language) {
  if (language === "he") {
    const by = [pattern.author && `מאת ${pattern.author}`, pattern.source_site_name && `מ-${pattern.source_site_name}`]
      .filter(Boolean)
      .join(" ");
    const materials = materialsList(pattern.translations?.he?.materials || pattern.materials);
    const intro = `דוגמית סריגה וקרושה${by ? ` ${by}` : ""}, מסודרת ב-Yarnboard.`;
    return shorten(intro + (materials ? ` חומרים: ${materials}.` : ""), DESCRIPTION_MAX);
  }
  const by = [pattern.author && `by ${pattern.author}`, pattern.source_site_name && `from ${pattern.source_site_name}`]
    .filter(Boolean)
    .join(" ");
  const materials = materialsList(pattern.materials);
  const intro = `A knitting & crochet pattern${by ? ` ${by}` : ""}, organized on Yarnboard.`;
  return shorten(intro + (materials ? ` Materials: ${materials}.` : ""), DESCRIPTION_MAX);
}

/** Only https images make it into a preview; a relative photo_url is our
 * own uploaded-photo route. */
function absolutePhoto(photoUrl, origin) {
  if (!photoUrl) return null;
  if (photoUrl.startsWith("/")) return origin + photoUrl;
  return photoUrl.startsWith("https://") ? photoUrl : null;
}

/** A public pattern, fetched as a logged-out guest (no cookies, so private
 * ones 404), or null if it's private, missing, or the API is slow. */
async function fetchPublicPattern(request, env, id) {
  try {
    const headers = apiHeaders(request, env);
    headers.delete("Cookie");
    headers.set("Accept", "application/json");
    const response = await fetch(new URL(`/api/patterns/${id}`, env.API_ORIGIN), {
      headers,
      signal: AbortSignal.timeout(PREVIEW_API_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const pattern = await response.json();
    return pattern?.title ? pattern : null;
  } catch {
    return null;
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

function tagMarkup(tags) {
  return tags
    .map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${escapeHtml(v)}"`).join(" ")} />`)
    .join("\n    ");
}

/**
 * Serves an app page (index.html) with its head filled in for *this* URL:
 * <html lang/dir>, canonical, hreflang links to the English and Hebrew
 * versions, and title/description/Open Graph in the page's language.
 * For a link-preview crawler on /pattern/<id> or /he/pattern/<id> of a
 * public pattern, the preview is that pattern's own title, description and
 * photo. Ordinary visitors never wait on the API: that call is for crawlers
 * only.
 */
async function servePage(request, env, url) {
  const page = await env.ASSETS.fetch(request);
  if (!page.ok || !(page.headers.get("Content-Type") || "").includes("text/html")) return page;

  const { language, bare } = pageLanguage(url.pathname);
  const site = SITE[language];
  const pageUrl = url.origin + pathFor(bare, language);
  let title = site.title;
  let description = site.description;
  let type = "website";
  let image = `${url.origin}/og-image.png`;
  let imageAlt = site.imageAlt;
  let defaultImage = true;

  const match = bare.match(PATTERN_PAGE);
  if (match && request.method === "GET" && PREVIEW_BOT.test(request.headers.get("User-Agent") || "")) {
    const pattern = await fetchPublicPattern(request, env, match[1]);
    if (pattern) {
      const name = (language === "he" && pattern.translations?.he?.title) || pattern.title;
      title = `${shorten(name, 70)} | Yarnboard`;
      description = describe(pattern, language);
      type = "article";
      imageAlt = name;
      const photo = absolutePhoto(pattern.photo_url, url.origin);
      if (photo) {
        image = photo;
        defaultImage = false;
      }
    }
  }

  const tags = [
    ["link", { rel: "canonical", href: pageUrl }],
    ["link", { rel: "alternate", hreflang: "en", href: url.origin + pathFor(bare, "en") }],
    ["link", { rel: "alternate", hreflang: "he", href: url.origin + pathFor(bare, "he") }],
    ["link", { rel: "alternate", hreflang: "x-default", href: url.origin + pathFor(bare, "en") }],
    ["meta", { name: "description", content: description }],
    ["meta", { property: "og:site_name", content: "Yarnboard" }],
    ["meta", { property: "og:type", content: type }],
    ["meta", { property: "og:title", content: title }],
    ["meta", { property: "og:description", content: description }],
    ["meta", { property: "og:url", content: pageUrl }],
    ["meta", { property: "og:locale", content: site.locale }],
    ["meta", { property: "og:locale:alternate", content: SITE[language === "he" ? "en" : "he"].locale }],
    ["meta", { property: "og:image", content: image }],
    ["meta", { property: "og:image:alt", content: imageAlt }],
    ["meta", { name: "twitter:card", content: "summary_large_image" }],
  ];
  if (defaultImage) {
    tags.push(["meta", { property: "og:image:width", content: "1200" }]);
    tags.push(["meta", { property: "og:image:height", content: "630" }]);
  }

  const remove = { element: (el) => el.remove() };
  return new HTMLRewriter()
    .on("html", {
      element: (el) => {
        el.setAttribute("lang", language);
        el.setAttribute("dir", language === "he" ? "rtl" : "ltr");
      },
    })
    .on('meta[property^="og:"]', remove)
    .on('meta[name^="twitter:"]', remove)
    .on('meta[name="description"]', remove)
    .on('link[rel="canonical"]', remove)
    .on('link[rel="alternate"][hreflang]', remove)
    .on("title", { element: (el) => el.setInnerContent(title) })
    .on("head", { element: (el) => el.append(`    ${tagMarkup(tags)}\n  `, { html: true }) })
    .transform(page);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/api/")) {
      return servePage(request, env, url);
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
