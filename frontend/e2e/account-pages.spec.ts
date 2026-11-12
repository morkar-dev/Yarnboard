/**
 * The per-account pages: My Saved (saving from Community and removing),
 * My Uploads, and notification settings -- each against the real backend.
 *
 * Logins come from global-setup's saved sessions, so this adds nothing to
 * the IP rate-limit buckets z-rate-limit.spec.ts relies on.
 */
import { expect, request, test } from "@playwright/test";
import { API_BASE_URL, PATTERNS } from "./fixtures";

test.describe("My Saved", () => {
  // e2e_carol: no seed pattern is hers, and no other spec saves patterns.
  test.use({ storageState: "e2e/.auth/carol.json" });

  test("a pattern saved from Community shows up in My Saved and can be removed there", async ({ page }) => {
    await page.goto("/saved");
    await expect(page.getByText("You haven't saved any patterns yet.")).toBeVisible();

    await page.goto("/community");
    const card = page.locator(".card").filter({ has: page.getByRole("link", { name: PATTERNS.english }) });
    await card.getByRole("button", { name: "Save" }).click();
    await expect(card.getByRole("button", { name: "Remove from Saved" })).toBeVisible();

    // Still saved after a reload -- it's stored server-side, not in the page.
    await page.reload();
    await expect(
      page.locator(".card").filter({ has: page.getByRole("link", { name: PATTERNS.english }) })
        .getByRole("button", { name: "Remove from Saved" }),
    ).toBeVisible();

    await page.getByRole("link", { name: "My Saved" }).click();
    await expect(page.getByRole("heading", { name: "My Saved Patterns" })).toBeVisible();
    const savedCard = page.locator(".card").filter({ has: page.getByRole("link", { name: PATTERNS.english }) });
    await expect(savedCard).toBeVisible();

    await savedCard.getByRole("button", { name: "Remove from Saved" }).click();
    await expect(savedCard).toHaveCount(0);
    await page.reload();
    await expect(page.getByText("You haven't saved any patterns yet.")).toBeVisible();
  });
});

test.describe("My Uploads", () => {
  test.use({ storageState: "e2e/.auth/alice.json" });

  test("lists the user's own patterns, private ones marked, and opens them", async ({ page }) => {
    await page.goto("/mine");
    await expect(page.getByRole("heading", { name: "My Uploads" })).toBeVisible();

    const publicCard = page.locator(".card").filter({ has: page.getByRole("link", { name: PATTERNS.english }) });
    await expect(publicCard).toBeVisible();
    await expect(publicCard.getByText("Private")).toHaveCount(0);

    const privateCard = page.locator(".card").filter({ has: page.getByRole("link", { name: PATTERNS.unpublished }) });
    await expect(privateCard.getByText("Private")).toBeVisible();

    // Someone else's pattern (e2e_bob's) never appears here.
    await expect(page.getByRole("link", { name: PATTERNS.permissions })).toHaveCount(0);

    await privateCard.getByRole("link", { name: PATTERNS.unpublished }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(PATTERNS.unpublished);
  });

  test("a user with no uploads sees the empty state", async ({ browser }) => {
    const context = await browser.newContext({ storageState: "e2e/.auth/carol.json" });
    const page = await context.newPage();
    await page.goto("/mine");
    await expect(page.getByText("You haven't submitted any patterns yet.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Submit one" })).toHaveAttribute("href", "/submit");
    await context.close();
  });
});

test.describe("notification settings", () => {
  // e2e_admin: e2e_carol's settings are a fixture notifications.spec.ts
  // depends on, so this test toggles someone else's.
  test.use({ storageState: "e2e/.auth/admin.json" });

  test("each switch saves on its own and survives a reload", async ({ page }) => {
    await page.goto("/settings/notifications");
    const updatedEmail = page.locator("#pattern_updated-email");
    const updatedInApp = page.locator("#pattern_updated-in-app");
    const sharedEmail = page.locator("#pattern_shared-email");

    // Defaults: everything on.
    await expect(updatedEmail).toBeChecked();
    await expect(updatedInApp).toBeChecked();
    await expect(sharedEmail).toBeChecked();

    const saved = page.waitForResponse(
      (res) => res.url().endsWith("/api/notification-settings") && res.request().method() === "PATCH",
    );
    await updatedEmail.uncheck();
    expect((await saved).ok()).toBe(true);

    await page.reload();
    await expect(page.locator("#pattern_updated-email")).not.toBeChecked();
    // Only that one switch changed.
    await expect(page.locator("#pattern_updated-in-app")).toBeChecked();
    await expect(page.locator("#pattern_shared-email")).toBeChecked();

    // And the server agrees, not just the page.
    const api = await request.newContext({ baseURL: API_BASE_URL, storageState: "e2e/.auth/admin.json" });
    const settings = await (await api.get("/api/notification-settings")).json();
    expect(settings.pattern_updated).toEqual({ email: false, in_app: true });
    await api.dispose();

    // Turn it back on.
    await page.locator("#pattern_updated-email").check();
    await page.reload();
    await expect(page.locator("#pattern_updated-email")).toBeChecked();
  });
});
