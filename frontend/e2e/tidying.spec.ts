/**
 * End-to-end coverage for the "tidying" round of UI changes: the icon-based
 * home page, sign-up validation, the friendly link-failure alert, material
 * links from scraping, the pattern page's headings/notes/row counters/
 * "Clear all checks", the review form's heading/note buttons, and the
 * navbar search. The pure parsing rules behind most of these are unit
 * tested in src/utils/patternText.test.tsx; this file checks they're wired
 * up in the real app against the real backend.
 *
 * Registration attempts here never reach the server (client-side
 * validation blocks them) and logins come from global-setup's saved
 * sessions, so this spec adds nothing to the IP rate-limit buckets
 * z-rate-limit.spec.ts relies on.
 */
import { expect, request, test, type Page } from "@playwright/test";

const API_BASE_URL = "http://localhost:5001";
const TITLE = "E2E Tidying Pattern";

let patternId: number;

test.beforeAll(async () => {
  // A public pattern exercising every step convention -- created via the
  // API as e2e_alice so guests and other users can open it too.
  const context = await request.newContext({ baseURL: API_BASE_URL, storageState: "e2e/.auth/alice.json" });
  const created = await context.post("/api/patterns/submit", {
    data: {
      original_url: "https://example.com/e2e-tidying-pattern",
      title: TITLE,
      author: "Tidy Author",
      materials: "- Yarn: [Drops Air](https://example.com/drops-air), 2 skeins\n- 4mm needles",
      abbreviations: "k = knit",
      instructions: {
        Body: [
          "# Brim",
          "> Use the smaller needles here.",
          "Cast on 96 stitches.",
          "Rows 1-3: k2, p2 around.",
          "## Crown",
          "Note: decrease evenly.",
          "Knit to the end.",
        ],
      },
    },
  });
  expect(created.ok()).toBeTruthy();
  patternId = (await created.json()).pattern.id;
  expect((await context.post(`/api/patterns/${patternId}/publish`)).ok()).toBeTruthy();
  await context.dispose();
});

async function noHorizontalOverflow(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
}

test.describe("home page", () => {
  test("shows the three steps and four icon tiles that link to their pages", async ({ page }) => {
    await page.goto("/");
    for (const step of ["Paste a link", "Review", "Stitch & check off"]) {
      await expect(page.locator(".home-steps").getByText(step, { exact: true })).toBeVisible();
    }
    const tiles = page.locator(".home-tile");
    await expect(tiles).toHaveCount(4);
    await expect(tiles.locator("svg")).toHaveCount(4);

    await page.getByRole("link", { name: "Submit a pattern", exact: true }).click();
    await expect(page).toHaveURL(/\/submit$/);
  });

  test("renders right-to-left in Hebrew without sideways scrolling", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "עברית" }).click();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByText("הדביקו קישור")).toBeVisible();
    await noHorizontalOverflow(page);
  });

  test("fits a phone screen", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await expect(page.locator(".home-tile")).toHaveCount(4);
    await noHorizontalOverflow(page);
  });
});

test.describe("sign-up form", () => {
  test("show/hide toggles both password fields", async ({ page }) => {
    await page.goto("/register");
    const password = page.getByLabel("Password", { exact: true });
    const confirm = page.getByLabel("Confirm password");
    await expect(password).toHaveAttribute("type", "password");

    await page.getByRole("button", { name: "Show password" }).click();
    await expect(password).toHaveAttribute("type", "text");
    await expect(confirm).toHaveAttribute("type", "text");

    await page.getByRole("button", { name: "Hide password" }).click();
    await expect(password).toHaveAttribute("type", "password");
  });

  test("password rules turn green as they're met", async ({ page }) => {
    await page.goto("/register");
    await expect(page.locator("#register-password-rules .text-success")).toHaveCount(0);

    await page.getByLabel("Password", { exact: true }).fill("abcdefgh");
    await expect(page.locator("#register-password-rules .text-success")).toHaveCount(2);

    await page.getByLabel("Password", { exact: true }).fill("abcdefg1");
    await expect(page.locator("#register-password-rules .text-success")).toHaveCount(3);
  });

  test("flags a mismatched confirmation while typing", async ({ page }) => {
    await page.goto("/register");
    await page.getByLabel("Password", { exact: true }).fill("knitting1");
    await page.getByLabel("Confirm password").fill("knit");
    await expect(page.getByText("Passwords don't match.")).toBeHidden();
    await page.getByLabel("Confirm password").fill("knitx");
    await expect(page.getByText("Passwords don't match.")).toBeVisible();
  });

  test("blocks an invalid form without calling the server", async ({ page }) => {
    let registerCalls = 0;
    page.on("request", (req) => {
      if (req.url().endsWith("/api/register")) registerCalls += 1;
    });
    await page.goto("/register");
    await page.getByLabel("Username").fill("someone");
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByLabel("Password", { exact: true }).fill("onlyletters");
    await page.getByLabel("Confirm password").fill("onlyletters");
    await page.getByRole("button", { name: "Sign up" }).click();

    await expect(page.getByText("Enter a valid email address, like name@example.com.")).toBeVisible();
    await expect(page.locator("#register-password-rules .text-danger")).toHaveCount(1);
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeHidden();
    expect(registerCalls).toBe(0);
  });
});

test.describe("submitting a pattern", () => {
  test.use({ storageState: "e2e/.auth/alice.json" });

  test("a link that can't be read shows the short, icon-based explanation on the upload tab", async ({ page }) => {
    await page.goto("/submit");
    await page.getByLabel("Pattern URL").fill("http://127.0.0.1/some-pattern");
    await page.getByRole("button", { name: "Preview" }).click();

    const alert = page.getByRole("alert");
    await expect(alert.getByText("That link didn't work")).toBeVisible();
    await expect(alert.getByText("We couldn't read that page automatically.")).toBeVisible();
    for (const chip of ["Site blocks it", "Needs a login", "Not the pattern page", "Ctrl/⌘ + S → HTML", "Share → Print → PDF"]) {
      await expect(alert.getByText(chip)).toBeVisible();
    }
    // The internal address never reaches the user.
    await expect(alert).not.toContainText("127.0.0.1");
    // Switched to the upload tab, with the alert still on screen.
    await expect(page.getByLabel("Saved HTML or PDF file")).toBeVisible();

    await alert.getByRole("button", { name: "Close alert" }).click();
    await expect(page.getByText("That link didn't work")).toBeHidden();
  });

  test("an uploaded page keeps its material links, and the review form can add headings and notes", async ({ page }) => {
    const html = `<html><body><article>
      <h1>Uploaded Links Pattern</h1>
      <h2>Materials</h2>
      <ul><li>Yarn: <a href="/shop/drops-air">Drops Air</a></li><li>4mm needles</li></ul>
      <h2>Instructions</h2>
      <ol><li>Cast on using the <a href="https://example.com/tutorial">long-tail method</a>.</li></ol>
    </article></body></html>`;

    await page.goto("/submit");
    await page.getByRole("button", { name: "Upload a file" }).click();
    await page.getByLabel("Pattern URL").fill("https://example.com/e2e-uploaded-links");
    await page.getByLabel("Saved HTML or PDF file").setInputFiles({
      name: "pattern.html",
      mimeType: "text/html",
      buffer: Buffer.from(html),
    });
    await page.getByRole("button", { name: "Preview from file" }).click();

    const materials = page.getByLabel("Materials");
    await expect(materials).toHaveValue(
      "Yarn: [Drops Air](https://example.com/shop/drops-air)\n4mm needles",
    );
    const stepValues = () => page.locator("input[type=text], input:not([type])").evaluateAll(
      (inputs) => inputs.map((input) => (input as HTMLInputElement).value),
    );
    // Instructions keep plain text only.
    expect(await stepValues()).toContain("Cast on using the long-tail method.");

    await page.getByRole("button", { name: "+ Add heading" }).click();
    await expect.poll(stepValues).toContain("## ");
    await page.getByRole("button", { name: "+ Add note" }).click();
    await expect.poll(stepValues).toContain("> ");
  });
});

test.describe("pattern page as a guest", () => {
  test("materials are a list with working source links", async ({ page }) => {
    await page.goto(`/pattern/${patternId}`);
    const items = page.locator(".materials-list li");
    await expect(items).toHaveCount(2);
    const link = page.getByRole("link", { name: "Drops Air" });
    await expect(link).toHaveAttribute("href", "https://example.com/drops-air");
    await expect(link).toHaveAttribute("target", "_blank");
  });

  test("headings and notes have no checkbox; real steps do", async ({ page }) => {
    await page.goto(`/pattern/${patternId}`);
    await expect(page.getByRole("heading", { name: "Brim" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Crown" })).toBeVisible();
    await expect(page.getByText("Use the smaller needles here.")).toBeVisible();
    await expect(page.getByText("Note: decrease evenly.")).toBeVisible();
    await expect(page.getByRole("checkbox")).toHaveCount(3);
  });

  test("the row counter counts up to the range, survives a reload, and Clear all resets everything", async ({ page }) => {
    await page.goto(`/pattern/${patternId}`);
    const plus = page.getByRole("button", { name: "One row done" });
    await plus.click();
    await expect(page.getByText("1 / 3 rows (next: row 2)")).toBeVisible();
    await plus.click();
    await plus.click();
    await expect(page.getByText("All 3 rows done")).toBeVisible();
    await expect(plus).toBeDisabled();
    await page.getByRole("button", { name: "One row back" }).click();
    await expect(page.getByText("2 / 3 rows (next: row 3)")).toBeVisible();

    await page.getByLabel("Cast on 96 stitches.").check();
    await page.reload();
    await expect(page.getByText("2 / 3 rows (next: row 3)")).toBeVisible();
    await expect(page.getByLabel("Cast on 96 stitches.")).toBeChecked();

    // Cancelling the confirm leaves everything alone.
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.getByRole("button", { name: "Clear all checks" }).click();
    await expect(page.getByLabel("Cast on 96 stitches.")).toBeChecked();

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Clear all checks" }).click();
    await expect(page.getByLabel("Cast on 96 stitches.")).not.toBeChecked();
    await expect(page.getByText("0 / 3 rows (next: row 1)")).toBeVisible();
    await expect(page.getByRole("button", { name: "Clear all checks" })).toBeDisabled();

    await page.reload();
    await expect(page.getByLabel("Cast on 96 stitches.")).not.toBeChecked();
    await expect(page.getByText("0 / 3 rows (next: row 1)")).toBeVisible();
  });
});

test.describe("pattern page when logged in", () => {
  test.use({ storageState: "e2e/.auth/carol.json" });

  test("Clear all checks clears progress saved on the server", async ({ page }) => {
    await page.goto(`/pattern/${patternId}`);
    const step = page.getByLabel("Knit to the end.");
    const saved = page.waitForResponse((r) => r.url().includes("/progress") && r.request().method() === "PATCH");
    await step.check();
    await saved;
    await page.reload();
    await expect(page.getByLabel("Knit to the end.")).toBeChecked();

    page.once("dialog", (dialog) => dialog.accept());
    const cleared = page.waitForResponse((r) => r.url().includes("/progress") && r.request().method() === "DELETE");
    await page.getByRole("button", { name: "Clear all checks" }).click();
    expect((await cleared).ok()).toBeTruthy();

    await page.reload();
    await expect(page.getByLabel("Knit to the end.")).not.toBeChecked();
  });
});

test.describe("navbar search", () => {
  test("expands, searches the community by title, and collapses with Escape", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("searchbox")).toBeHidden();
    await page.getByRole("button", { name: "Open search" }).click();
    const box = page.getByRole("searchbox", { name: "Search patterns..." });
    await expect(box).toBeFocused();

    await box.fill("tidying");
    await box.press("Enter");
    await expect(page).toHaveURL(/\/community\?q=tidying$/);
    await expect(page.getByText('1 pattern matching "tidying".')).toBeVisible();
    await expect(page.getByRole("link", { name: TITLE })).toBeVisible();

    await page.getByRole("link", { name: "Clear search" }).click();
    await expect(page).toHaveURL(/\/community$/);

    await page.getByRole("button", { name: "Open search" }).click();
    await page.getByRole("searchbox").press("Escape");
    await expect(page.getByRole("searchbox")).toBeHidden();
  });

  test("matches authors too, and says when nothing matches", async ({ page }) => {
    await page.goto("/community?q=tidy%20author");
    await expect(page.getByRole("link", { name: TITLE })).toBeVisible();

    await page.goto("/community?q=zzz-no-such-pattern");
    await expect(page.getByText('0 patterns matching "zzz-no-such-pattern".')).toBeVisible();
  });

  test.describe("logged in, on a laptop-width screen", () => {
    test.use({ storageState: "e2e/.auth/alice.json", viewport: { width: 1280, height: 800 } });

    test("the open box is about half the row and floats over the links without overflow", async ({ page }) => {
      await page.goto("/community");
      await page.getByRole("button", { name: "Open search" }).click();
      const box = await page.getByRole("searchbox").boundingBox();
      const row = await page.locator(".navbar-collapse").boundingBox();
      expect(box!.width).toBeGreaterThan(row!.width * 0.4);
      expect(box!.x).toBeGreaterThanOrEqual(0);
      await noHorizontalOverflow(page);
    });

    test("in Hebrew the box grows toward the logo, still on screen", async ({ page }) => {
      await page.goto("/community");
      await page.getByRole("button", { name: "עברית" }).click();
      await page.getByRole("button", { name: "פתיחת החיפוש" }).click();
      const box = await page.getByRole("searchbox").boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(1280);
      await noHorizontalOverflow(page);
    });
  });

  test("on a phone it sits inside the menu at full width", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/community");
    await page.getByRole("button", { name: "Toggle navigation" }).click();
    await page.getByRole("button", { name: "Open search" }).click();
    await expect(page.getByRole("searchbox")).toBeVisible();
    await noHorizontalOverflow(page);
  });
});
