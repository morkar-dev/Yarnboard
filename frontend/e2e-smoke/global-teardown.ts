import { request } from "@playwright/test";
import fs from "node:fs";
import { safeApi } from "./api";
import { deleteSmokePatterns } from "./cleanup";
import { AUTH_FILE, SMOKE_BASE_URL } from "./fixtures";

/** Removes this run's smoke pattern, so the account doesn't fill up. */
export default async function globalTeardown() {
  if (!fs.existsSync(AUTH_FILE)) return; // setup never logged in
  const api = safeApi(await request.newContext({ baseURL: SMOKE_BASE_URL(), storageState: AUTH_FILE }));
  try {
    await deleteSmokePatterns(api);
  } finally {
    await api.dispose();
  }
}
