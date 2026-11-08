import type { APIRequestContext } from "@playwright/test";
import { SMOKE_PATTERN_TITLE } from "./fixtures";

/** Deletes every pattern of the logged-in smoke account that has the
 * smoke title -- and only those, so nothing else in the account is touched. */
export async function deleteSmokePatterns(api: APIRequestContext) {
  const mine = await api.get("/api/patterns/mine");
  if (!mine.ok()) throw new Error(`[smoke] listing own patterns failed: HTTP ${mine.status()}`);
  const leftovers = (await mine.json()).filter((p: { title: string }) => p.title === SMOKE_PATTERN_TITLE);
  for (const pattern of leftovers) {
    const deleted = await api.delete(`/api/patterns/${pattern.id}`);
    if (!deleted.ok()) {
      throw new Error(`[smoke] deleting smoke pattern ${pattern.id} failed: HTTP ${deleted.status()}`);
    }
  }
}
