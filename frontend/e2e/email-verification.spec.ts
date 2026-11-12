/**
 * Email verification edge cases: a missing/invalid link, an expired link,
 * and resending a fresh link from the login page. Real email delivery is
 * out of scope here (Resend is disabled for e2e runs); tokens are read
 * and backdated straight from the e2e database via the flask CLI helpers
 * in fixtures.ts.
 *
 * Rate limits: registers 2 accounts (register: 10/hour), resends once
 * (5/hour), and makes 3 login attempts (shared 20/hour bucket) -- all
 * before z-rate-limit.spec.ts, which only needs that bucket to run out
 * eventually.
 */
import { expect, request, test } from "@playwright/test";
import { API_BASE_URL, expireVerifyToken, readVerifyToken } from "./fixtures";

async function registerViaApi(label: string) {
  const stamp = Date.now();
  const user = {
    username: `e2e_${label}_${stamp}`,
    email: `e2e-${label}-${stamp}@e2e.test`,
    password: "password123",
  };
  const api = await request.newContext({ baseURL: API_BASE_URL });
  const response = await api.post("/api/register", { data: user });
  expect(response.ok(), await response.text()).toBe(true);
  await api.dispose();
  return user;
}

test("a verification link with no token, or an unknown one, explains what's wrong", async ({ page }) => {
  await page.goto("/verify-email");
  await expect(page.getByText("This verification link is missing its token.")).toBeVisible();

  await page.goto("/verify-email?token=not-a-real-token");
  await expect(page.getByText("Invalid or already-used verification link.")).toBeVisible();
  await page.getByRole("link", { name: "Back to login" }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("an expired verification link is refused and the account stays unverified", async ({ page }) => {
  const user = await registerViaApi("expired");
  const token = readVerifyToken(user.email);
  expect(token).not.toBeNull();
  expireVerifyToken(user.email);

  await page.goto(`/verify-email?token=${token}`);
  await expect(page.getByText("This verification link has expired. Request a new one.")).toBeVisible();

  // Still can't log in.
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByText("Please verify your email before logging in.", { exact: false })).toBeVisible();
});

test("resending from the login page issues a new link; the old one stops working", async ({ page }) => {
  const user = await registerViaApi("resend");
  const oldToken = readVerifyToken(user.email);
  expect(oldToken).not.toBeNull();

  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByText("Please verify your email before logging in.", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "Resend verification email" }).click();
  await expect(page.getByText("Verification email sent - check your inbox.")).toBeVisible();

  const newToken = readVerifyToken(user.email);
  expect(newToken).not.toBeNull();
  expect(newToken).not.toBe(oldToken);

  await page.goto(`/verify-email?token=${oldToken}`);
  await expect(page.getByText("Invalid or already-used verification link.")).toBeVisible();

  await page.goto(`/verify-email?token=${newToken}`);
  await page.getByRole("link", { name: "Go to login" }).click();
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByRole("button", { name: `Hi, ${user.username}` })).toBeVisible();
});
