/**
 * Wakes the Render API *directly* before the smoke tests run.
 *
 *   node e2e-smoke/wake-api.mjs https://yarnboard-dev-api.onrender.com
 *
 * Render's free plan puts an idle service to sleep, and requests that
 * arrive through the Cloudflare Worker can't wake it: Render throttles
 * wake-ups from Cloudflare's shared addresses (429,
 * x-render-routing: hibernate-rate-limited) for as long as it likes. A
 * request straight to the onrender.com URL, from this runner's own
 * address, wakes it within a minute. Once it's up, the tests go through
 * the Worker as usual.
 *
 * Polls gently (every 20 s) so Render's bot protection doesn't start
 * challenging the runner. Exits 0 once /api/health answers 200, 1 if it
 * never does.
 */
const base = (process.argv[2] || "").replace(/\/+$/, "");
if (!base) {
  console.error("Usage: node e2e-smoke/wake-api.mjs <API URL>");
  process.exit(2);
}

const DEADLINE_MS = 8 * 60_000;
const POLL_MS = 20_000;
const started = Date.now();

while (Date.now() - started < DEADLINE_MS) {
  let note;
  try {
    const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(60_000) });
    if (response.ok) {
      console.log(`[wake] ${base} is up after ${Math.round((Date.now() - started) / 1000)} s`);
      process.exit(0);
    }
    const routing = response.headers.get("x-render-routing");
    const challenge = response.headers.get("cf-mitigated");
    note = `HTTP ${response.status}${routing ? `, x-render-routing: ${routing}` : ""}${challenge ? `, cf-mitigated: ${challenge}` : ""}`;
  } catch (error) {
    note = error instanceof Error ? error.message : String(error);
  }
  console.log(`[wake] not up yet (${note}); retrying in ${POLL_MS / 1000} s`);
  await new Promise((resolve) => setTimeout(resolve, POLL_MS));
}

console.error(`::error::${base} didn't wake within ${DEADLINE_MS / 60_000} minutes. Restart it from the Render dashboard.`);
process.exit(1);
