/**
 * Browser half of the speed & SEO audit check (the HTTP/file/DNS half is
 * scripts/audit/seo_audit.py) -- run via `make audit` / `make audit-local`.
 *
 *  1. Console errors: loads a few public pages in Playwright's Chromium
 *     and fails on any console.error or uncaught exception (PageSpeed
 *     flagged "Browser errors were logged to the console").
 *  2. Lighthouse (desktop preset, same as the original audit): fails if
 *     CLS > 0.1 -- the layout-shift bug that cost the most points -- and
 *     prints the category scores plus the "needs a human" numbers (unused
 *     JS/CSS, legacy JS, non-composited animations) for context. Writes
 *     the full report to frontend/audit-report.report.html, which has the
 *     Treemap for digging into unused JavaScript.
 *
 * Usage: node scripts/audit-browser.mjs [URL]
 * AUDIT_SKIP_LIGHTHOUSE=1 skips step 2 (it takes ~30s and downloads
 * Lighthouse via npx on first use).
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const LIGHTHOUSE = "lighthouse@12.6.0";
const CLS_LIMIT = 0.1;
const PAGES = ["/", "/community", "/register", "/terms"];

const base = (process.argv[2] ?? "https://www.yarnboard.net").replace(/\/$/, "");
const frontendDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const color = process.stdout.isTTY;
const paint = (code, text) => (color ? `\x1b[${code}m${text}\x1b[0m` : text);
const TAGS = { PASS: paint(32, "PASS"), FAIL: paint(31, "FAIL"), WARN: paint(33, "WARN"), INFO: paint(90, "INFO") };

let failed = 0;
function report(status, check, detail = "") {
  if (status === "FAIL") failed += 1;
  console.log(`    ${TAGS[status]}  ${check}${detail ? ` -- ${detail}` : ""}`);
}

console.log(`\n  Browser checks -- ${base}`);

// --- 1. Console errors ------------------------------------------------
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const route of PAGES) {
    const errors = [];
    const onConsole = (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    };
    const onPageError = (err) => errors.push(err.message);
    page.on("console", onConsole);
    page.on("pageerror", onPageError);
    await page.goto(base + route, { waitUntil: "networkidle" });
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
    // A logged-out visitor's own /api/profile 401 is expected, not a bug.
    const real = errors.filter((e) => !/status of 401/.test(e));
    if (real.length) {
      const first = real.map((e) => e.split("\n")[0]);
      report("FAIL", `Console errors on ${route}`, `${real.length}: ${first.slice(0, 2).join(" | ").slice(0, 160)}`);
    }
    else report("PASS", `Console errors on ${route}`, "none");
  }
} finally {
  await browser.close();
}

// --- 2. Lighthouse ----------------------------------------------------
if (process.env.AUDIT_SKIP_LIGHTHOUSE === "1") {
  report("INFO", "Lighthouse", "skipped (AUDIT_SKIP_LIGHTHOUSE=1)");
} else {
  const outBase = path.join(frontendDir, "audit-report");
  const run = spawnSync(
    "npx",
    [
      "-y",
      LIGHTHOUSE,
      `${base}/`,
      "--preset=desktop",
      "--output=json",
      "--output=html",
      `--output-path=${outBase}`,
      "--chrome-flags=--headless=new --no-sandbox",
      "--quiet",
    ],
    { cwd: frontendDir, env: { ...process.env, CHROME_PATH: chromium.executablePath() }, stdio: ["ignore", "ignore", "pipe"] },
  );
  if (run.status !== 0) {
    report("FAIL", "Lighthouse", `didn't run: ${String(run.stderr).trim().split("\n").pop()}`);
  } else {
    const lhr = JSON.parse(readFileSync(`${outBase}.report.json`, "utf-8"));
    const cls = lhr.audits["cumulative-layout-shift"].numericValue;
    report(cls <= CLS_LIMIT ? "PASS" : "FAIL", "Cumulative Layout Shift", `${cls.toFixed(3)} (limit ${CLS_LIMIT}; audit found 0.565)`);

    for (const [id, label] of [
      ["performance", "Performance"],
      ["accessibility", "Accessibility"],
      ["best-practices", "Best Practices"],
      ["seo", "SEO"],
    ]) {
      const score = Math.round((lhr.categories[id]?.score ?? 0) * 100);
      report(score >= 90 ? "PASS" : "WARN", `Lighthouse ${label}`, `${score} / 100`);
    }

    const kib = (bytes) => `${Math.round((bytes ?? 0) / 1024)} KiB`;
    const savings = (id) => lhr.audits[id]?.details?.overallSavingsBytes;
    report("INFO", "Unused JavaScript", `~${kib(savings("unused-javascript"))} could be saved (audit: 55 KiB)`);
    report("INFO", "Unused CSS", `~${kib(savings("unused-css-rules"))} could be saved (audit: 30 KiB)`);
    report("INFO", "Legacy JavaScript", `~${kib(savings("legacy-javascript"))} could be saved`);
    const animated = lhr.audits["non-composited-animations"]?.details?.items?.length ?? 0;
    report("INFO", "Non-composited animations", `${animated} element(s) (audit: 9)`);
    report("INFO", "Full report", `frontend/audit-report.report.html (open it for the Treemap)`);
  }
}

console.log(`\n  ${failed ? paint(31, `${failed} browser check(s) failed`) : paint(32, "browser checks passed")}\n`);
process.exit(failed ? 1 : 0);
