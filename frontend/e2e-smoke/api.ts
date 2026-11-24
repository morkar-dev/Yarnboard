import { test as base, type APIRequestContext } from "@playwright/test";

/**
 * API calls for the smoke tests, with two fixes over Playwright's own:
 *
 * - A dropped connection (ECONNRESET and friends) is retried a couple of
 *   times: a deployed site on Render's free tier does that now and then,
 *   and it says nothing about the code. HTTP errors and timeouts are not
 *   retried -- those are real answers.
 * - Errors never carry Playwright's "Call log", which lists the request
 *   headers, session cookie included. The GitHub repo is public, so its
 *   Actions logs and reports are too.
 */
const NETWORK_ERROR = /ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|socket hang up|other side closed/i;
const ATTEMPTS = 3;
const RETRY_DELAY_MS = 5_000;
const METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "fetch"]);

/** The error's own message, without the call log or any header values. */
export function cleanError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  const withoutCallLog = message.split(/\n\s*Call log:/)[0];
  return new Error(
    withoutCallLog.replace(/^(\s*-?\s*(?:cookie|set-cookie|authorization|x-yarnboard-[\w-]+):).*$/gim, "$1 <hidden>"),
  );
}

export function safeApi(api: APIRequestContext): APIRequestContext {
  return new Proxy(api, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      if (!METHODS.has(String(prop))) return value.bind(target);
      return async (...args: unknown[]) => {
        for (let attempt = 1; ; attempt++) {
          try {
            return await value.apply(target, args);
          } catch (error) {
            const call = `${String(prop).toUpperCase()} ${String(args[0])}`;
            const cleaned = cleanError(error);
            if (attempt >= ATTEMPTS || !NETWORK_ERROR.test(cleaned.message)) {
              throw new Error(`[smoke] ${call} failed: ${cleaned.message.replace(/^apiRequestContext\.\w+: /, "")}`);
            }
            console.log(
              `[smoke] ${call} lost its connection ` +
                `(attempt ${attempt} of ${ATTEMPTS}); retrying...`,
            );
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
          }
        }
      };
    },
  });
}

/** `test` with an `api` fixture: the logged-in request context, made safe. */
export const test = base.extend<{ api: APIRequestContext }>({
  api: async ({ request }, provide) => {
    await provide(safeApi(request));
  },
});
