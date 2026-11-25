import { expect, request, test } from "@playwright/test";

const API_BASE_URL = "http://localhost:5001";
// Unique per run, so the check can't pass on a leftover from earlier.
const SUBJECT = `Photos are back ${Date.now()}`;

test.beforeAll(async () => {
  // e2e_admin opts in (the only subscriber needed) and sends a newsletter.
  // RESEND_NEWSLETTER is empty under `make e2e`, so it's logged, not emailed.
  const admin = await request.newContext({ baseURL: API_BASE_URL, storageState: "e2e/.auth/admin.json" });
  await admin.put("/api/newsletter/subscription", { data: { subscribed: true } });
  const { subscriber_count } = await (await admin.get("/api/admin/newsletter")).json();
  const sent = await admin.post("/api/admin/newsletter/send", {
    data: {
      subject: SUBJECT,
      body: "Uploading pattern photos works again.\n\nTry it: https://www.yarnboard.net/submit",
      expected_count: subscriber_count,
    },
  });
  expect(sent.ok(), await sent.text()).toBe(true);
  await admin.dispose();
});

test("a guest finds a sent newsletter on the Updates page", async ({ page }) => {
  await page.goto("/community");
  await page.getByRole("navigation").getByRole("link", { name: "Updates" }).click();

  await expect(page).toHaveURL(/\/updates$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("What's new");
  const post = page.getByRole("article").filter({ hasText: SUBJECT });
  await expect(post.getByRole("heading", { name: SUBJECT })).toBeVisible();
  await expect(post.getByText("Uploading pattern photos works again.")).toBeVisible();
  await expect(post.getByRole("link", { name: "https://www.yarnboard.net/submit" })).toHaveAttribute(
    "href",
    "https://www.yarnboard.net/submit",
  );
});

test("the Updates page has a Hebrew version", async ({ page }) => {
  await page.goto("/he/updates");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("מה חדש");
  await expect(page.getByRole("article").filter({ hasText: SUBJECT })).toBeVisible();
});
