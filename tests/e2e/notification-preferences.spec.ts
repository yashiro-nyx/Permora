import { expect, test, type Page } from "@playwright/test";
import { E2E, e2eClientHeaders, e2ePassword } from "./staff-fixture";

test.describe.configure({ mode: "serial" });

let user: Page;

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test.beforeAll(async ({ browser }) => {
  user = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    extraHTTPHeaders: e2eClientHeaders(51),
  });
  // Preferences are user-owned; the requester account exercises the common case.
  await signIn(user, E2E.requester.email);
});

test.afterAll(async () => {
  await user.close();
});

test("unauthenticated visitors are redirected to login", async ({ browser }) => {
  const anon = await browser.newPage({ extraHTTPHeaders: e2eClientHeaders(52) });
  await anon.goto("/account/notifications");
  await expect(anon).toHaveURL(/\/login/);
  await anon.close();
});

test("notification settings show editable in-app and unavailable external channels", async () => {
  await user.goto("/account/notifications");
  await expect(
    user.getByRole("heading", { name: "Notification settings" }),
  ).toBeVisible();
  await expect(user.getByText(/External notification channels .* are not configured/)).toBeVisible();

  // In-app is enabled and editable.
  const inApp = user.locator("#preference-inAppEnabled");
  await expect(inApp).toBeEnabled();

  // External channels are present but disabled and marked unavailable.
  await expect(user.locator("#preference-externalEmailEnabled")).toBeDisabled();
  await expect(user.locator("#preference-externalSmsEnabled")).toBeDisabled();
  await expect(user.locator("#preference-externalPushEnabled")).toBeDisabled();
  await expect(
    user.getByText("Not available yet").first(),
  ).toBeVisible();
});

test("saving the in-app preference persists after reload", async () => {
  await user.goto("/account/notifications");
  const inApp = user.locator("#preference-inAppEnabled");

  // Capture the current state and toggle it.
  const wasChecked = await inApp.isChecked();
  await inApp.setChecked(!wasChecked);
  const saveButton = user.getByRole("button", { name: "Save preferences" });
  await expect(saveButton).toBeEnabled();
  await saveButton.click();
  await expect(
    user.getByText("Your notification preferences were saved."),
  ).toBeVisible();

  // Reload and confirm the new value persisted.
  await user.reload();
  await expect(user.locator("#preference-inAppEnabled")).toBeChecked({ checked: !wasChecked });

  // Restore the original value to keep the shared fixture stable.
  await user.locator("#preference-inAppEnabled").setChecked(wasChecked);
  await user.getByRole("button", { name: "Save preferences" }).click();
  await expect(
    user.getByRole("status").filter({ hasText: "Preferences saved" }).filter({ hasText: "Your notification preferences were saved." }),
  ).toBeVisible();
});

test("the notification center remains reachable from settings", async () => {
  await user.goto("/account/notifications");
  await user.getByRole("link", { name: "View notification center" }).click();
  await expect(user).toHaveURL(/\/notifications$/);
});

for (const width of [390, 320]) {
  test(`notification settings fit ${width}px without document overflow`, async () => {
    await user.setViewportSize({ width, height: 900 });
    await user.goto("/account/notifications");
    expect(
      await user.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
  });
}
