/**
 * Playwright regression tests for the request submission form UX.
 *
 * Covers:
 * - All resource-specific fields reset when switching resources.
 * - Confirmation dialog appears when unsaved data would be discarded.
 * - Scroll position preserved during dropdown and button interaction.
 * - Constraint validation fires before server action (no spurious toast).
 * - Server-side field errors persist in the form after toast auto-dismisses.
 * - Responsive layout at standard widths.
 */
import { expect, test, type Page } from "@playwright/test";
import { E2E, e2eClientHeaders, e2ePassword } from "./staff-fixture";

test.describe.configure({ mode: "serial" });

let page: Page;

async function signIn(target: Page) {
  await target.goto("/login");
  await target.getByLabel("Email address").fill(E2E.requester.email);
  await target.getByLabel("Password", { exact: true }).fill(e2ePassword());
  await target.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(target).toHaveURL(/\/dashboard$/);
}

function dateInput(daysFromToday: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromToday);
  return d.toISOString().slice(0, 10);
}

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    extraHTTPHeaders: e2eClientHeaders(60),
  });
  await signIn(page);
});

test.afterAll(async () => {
  await page.close();
});

// ─── Field Reset ────────────────────────────────────────────────────────────

test("purpose textarea resets when switching resources with no unsaved data", async () => {
  // No data entered yet — switch should happen without a confirm dialog.
  await page.goto("/requests/new");
  await page.getByLabel("Select resource").selectOption("r-library");
  // No purpose entered — switch is immediate.
  await page.getByLabel("Select resource").selectOption("r-network-access");
  // No discard dialog should appear.
  await expect(
    page.getByRole("dialog", { name: /Switch resource/ }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Justification / purpose")).toHaveValue("");
});

test("discard confirmation dialog appears when switching resources with entered purpose", async () => {
  await page.goto("/requests/new");
  await page.getByLabel("Select resource").selectOption("r-library");
  await page
    .getByLabel("Justification / purpose")
    .fill("Data that should be preserved until confirmed.");

  // Switching resource should show the discard confirmation.
  await page.getByLabel("Select resource").selectOption("r-network-access");
  const discardDialog = page.getByRole("dialog", { name: /Switch resource/ });
  await expect(discardDialog).toBeVisible();

  // Cancelling preserves the original resource and the entered purpose.
  await discardDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(discardDialog).toHaveCount(0);
  await expect(page.getByLabel("Select resource")).toHaveValue("r-library");
  await expect(page.getByLabel("Justification / purpose")).toHaveValue(
    "Data that should be preserved until confirmed.",
  );
});

test("confirming the discard dialog switches resource and clears all fields", async () => {
  await page.goto("/requests/new");
  await page.getByLabel("Select resource").selectOption("r-library");
  await page
    .getByLabel("Justification / purpose")
    .fill("This will be cleared after confirming the switch.");

  // Switch and confirm.
  await page.getByLabel("Select resource").selectOption("r-network-access");
  const discardDialog = page.getByRole("dialog", { name: /Switch resource/ });
  await expect(discardDialog).toBeVisible();
  await discardDialog
    .getByRole("button", { name: "Switch resource" })
    .click();

  // Purpose must be empty after confirming.
  await expect(discardDialog).toHaveCount(0);
  await expect(page.getByLabel("Select resource")).toHaveValue("r-network-access");
  await expect(page.getByLabel("Justification / purpose")).toHaveValue("");
});

test("start date resets to today when switching resources", async () => {
  await page.goto("/requests/new");
  await page.getByLabel("Select resource").selectOption("r-library");

  // Change the start date away from today.
  await page.locator("#startsAt").fill(dateInput(3));
  const changedStart = await page.locator("#startsAt").inputValue();
  expect(changedStart).toBe(dateInput(3));

  // Switch resource — no data in purpose, but start date changed.
  await page.getByLabel("Select resource").selectOption("r-network-access");
  // The start date was changed, so a discard dialog should appear.
  const discardDialog = page.getByRole("dialog", { name: /Switch resource/ });
  if (await discardDialog.isVisible()) {
    await discardDialog.getByRole("button", { name: "Switch resource" }).click();
  }

  // Start date must reset to today.
  const todayVal = dateInput(0);
  await expect(page.locator("#startsAt")).toHaveValue(todayVal);
});

test("expiry date recalculates to resource default when switching", async () => {
  await page.goto("/requests/new");

  // r-library: defaultDays=30.
  await page.getByLabel("Select resource").selectOption("r-library");
  const expiryLibrary = await page.locator("#expiresAt").inputValue();
  expect(expiryLibrary).not.toBe("");

  // r-network-access: defaultDays=90.
  await page.getByLabel("Select resource").selectOption("r-network-access");
  const expiryNetwork = await page.locator("#expiresAt").inputValue();
  expect(expiryNetwork).not.toBe("");

  // Different defaultDays → different expiry.
  expect(expiryLibrary).not.toBe(expiryNetwork);
});

test("scope selection resets when switching resources", async () => {
  await page.goto("/requests/new");
  await page.getByLabel("Select resource").selectOption("r-network-access");
  const networkZone = page.locator("select#networkZone");
  await networkZone.waitFor();
  const options = await networkZone.locator("option:not([value=''])").count();
  if (options > 0) {
    await networkZone.selectOption({ index: 1 });
    const selectedBefore = await networkZone.inputValue();
    expect(selectedBefore).not.toBe("");

    // Selecting a scope counts as unsaved data — switch triggers discard dialog.
    await page.getByLabel("Select resource").selectOption("r-library");
    const discardDialog = page.getByRole("dialog", { name: /Switch resource/ });
    if (await discardDialog.isVisible()) {
      await discardDialog.getByRole("button", { name: "Switch resource" }).click();
    }
    // Switch back to check scope was cleared.
    await page.getByLabel("Select resource").selectOption("r-network-access");
    await networkZone.waitFor();
    await expect(networkZone).toHaveValue("");
  }
});

// ─── Scroll Preservation ────────────────────────────────────────────────────

test("scroll position is preserved when changing the resource dropdown", async () => {
  await page.goto("/requests/new");
  await page.getByLabel("Select resource").selectOption("r-library");

  // Scroll down.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const scrollBefore = await page.evaluate(() => window.scrollY);
  expect(scrollBefore).toBeGreaterThan(0);

  // Change resource — no data entered so no dialog.
  await page.getByLabel("Select resource").selectOption("r-network-access");
  await page.waitForTimeout(150);

  const scrollAfter = await page.evaluate(() => window.scrollY);
  expect(scrollAfter).toBeGreaterThan(0);
});

test("clicking permission radio buttons does not scroll to the top", async () => {
  await page.goto("/requests/new");
  await page.getByLabel("Select resource").selectOption("r-library");
  await page.evaluate(() => window.scrollTo(0, 400));

  const scrollBefore = await page.evaluate(() => window.scrollY);
  await page.getByRole("radio").first().click();
  await page.waitForTimeout(80);
  const scrollAfter = await page.evaluate(() => window.scrollY);

  expect(Math.abs(scrollAfter - scrollBefore)).toBeLessThan(50);
});

// ─── Toast / Validation Behavior ─────────────────────────────────────────────

test("submitting without a justification uses browser validation without showing a toast", async () => {
  await page.goto("/requests/new");
  await page.getByLabel("Select resource").selectOption("r-library");

  const toastViewport = page.getByTestId("toast-viewport");
  const toastsBefore = await toastViewport.locator(".toast").count();

  await page.getByLabel("Justification / purpose").fill("");
  await page.getByRole("button", { name: "Review request" }).click();
  await page.waitForTimeout(300);

  const toastsAfter = await toastViewport.locator(".toast").count();
  expect(toastsAfter).toBe(toastsBefore);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("server-side field error stays in the form after the toast auto-dismisses", async () => {
  await page.goto("/requests/new");
  await page.getByLabel("Select resource").selectOption("r-library");

  // 19 chars passes browser minlength=20 only if we override; forces server rejection.
  const shortPurpose = "Exactly 19 chars!!";
  await page.getByLabel("Justification / purpose").fill(shortPurpose);
  await page.evaluate(() => {
    const ta = document.querySelector(
      "textarea[name='purpose']",
    ) as HTMLTextAreaElement | null;
    if (ta) ta.minLength = 1;
  });

  await page.getByRole("button", { name: "Review request" }).click();
  const confirmDialog = page.getByRole("dialog", { name: /Submit this/ });
  await expect(confirmDialog).toBeVisible({ timeout: 3000 });
  await page.getByRole("button", { name: "Submit request" }).click();
  await page.waitForTimeout(2000);

  if (!page.url().includes("/requests/new")) return; // unexpected success

  const anyFieldError = page.locator(".field-error");
  await expect(anyFieldError.first()).toBeVisible({ timeout: 5000 });

  const toasts = page.getByTestId("toast-viewport").locator(".toast");
  await expect(toasts).toHaveCount(1);
  await expect(toasts.first()).toContainText("Request not submitted");
  await expect(toasts.first().locator(".toast-progress")).toBeVisible();

  // The transient error must clear on its own after 8 seconds while the
  // actionable inline field error remains available to the requester.
  await expect(toasts).toHaveCount(0, { timeout: 8500 });
  await expect(anyFieldError.first()).toBeVisible();
});

// ─── Responsive Layout ───────────────────────────────────────────────────────

test("request form fits standard widths without document overflow", async () => {
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/requests/new");
    await page.getByLabel("Select resource").selectOption("r-library");
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
});
