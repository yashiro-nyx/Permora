import { expect, test } from "@playwright/test";
import { E2E, e2eClientHeaders, signIn } from "./staff-fixture";

test.describe.configure({ mode: "serial" });

test("administrator shell presents six primary destinations and the access overview", async ({
  browser,
}) => {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    extraHTTPHeaders: e2eClientHeaders(70),
  });
  await signIn(page, E2E.administrator.email);
  await page.goto("/dashboard");

  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  await expect(navigation.locator(":scope > .nav-link")).toHaveCount(5);
  await expect(navigation.locator(":scope > .nav-group > .nav-link")).toHaveCount(1);
  await expect(navigation.getByRole("link", { name: "Dashboard" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Activations" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Request Routing" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Audit Logs" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "User Management" })).toBeVisible();
  await expect(navigation.getByRole("button", { name: "System Settings" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Access Management Overview" })).toBeVisible();
  await expect(page.getByText(/provisioning, routing, auditability/i)).toBeVisible();
  await page.screenshot({ path: "test-results/admin-dashboard.png", fullPage: true });
  await page.close();
});

test("system settings expands automatically and retains nested route access", async ({
  browser,
}) => {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    extraHTTPHeaders: e2eClientHeaders(71),
  });
  await signIn(page, E2E.administrator.email);
  await page.goto("/resources");
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  const settings = navigation.getByRole("button", { name: "System Settings" });
  await expect(settings).toHaveAttribute("aria-expanded", "true");
  for (const label of [
    "Resource Catalog",
    "Approver Responsibilities",
    "Delegations & Absences",
    "Institutional Identifiers",
    "Permissions",
    "Retention",
    "Reports & Analytics",
  ]) {
    await expect(navigation.getByRole("link", { name: label })).toBeVisible();
  }
  await page.screenshot({ path: "test-results/admin-settings-expanded.png", fullPage: true });
  await settings.click();
  await expect(settings).toHaveAttribute("aria-expanded", "false");
  await page.close();
});

test("administrator profile menu preserves account, notification, support, and logout access", async ({
  browser,
}) => {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    extraHTTPHeaders: e2eClientHeaders(72),
  });
  await signIn(page, E2E.administrator.email);
  await page.goto("/dashboard");
  const trigger = page.getByRole("button", { name: /Avery Administrator profile menu/ });
  await trigger.click();
  const menu = page.getByRole("menu", { name: "Administrator profile menu" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: /Account settings/ })).toHaveAttribute("href", "/account/password");
  await expect(menu.getByRole("menuitem", { name: /Notification settings/ })).toHaveAttribute("href", "/account/notifications");
  await expect(menu.getByRole("menuitem", { name: /Help & support/ })).toHaveAttribute("href", "/help");
  await expect(menu.getByRole("button", { name: /Log out/ })).toBeVisible();
  await page.screenshot({ path: "test-results/admin-profile-menu.png", fullPage: true });
  await page.keyboard.press("Escape");
  await expect(menu).not.toBeVisible();
  await page.close();
});

test("mobile administrator drawer keeps settings and logout accessible", async ({ browser }) => {
  const page = await browser.newPage({
    viewport: { width: 390, height: 600 },
    extraHTTPHeaders: e2eClientHeaders(73),
  });
  await signIn(page, E2E.administrator.email);
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Open navigation" }).click();
  const drawer = page.getByRole("dialog", { name: "Your workspace" });
  await expect(drawer).toBeVisible();
  const navigation = drawer.getByRole("navigation", { name: "Mobile navigation" });
  await expect(navigation.getByRole("button", { name: "System Settings" })).toBeVisible();
  await navigation.getByRole("button", { name: "System Settings" }).click();
  await expect(navigation.getByRole("link", { name: "Resource Catalog" })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Log out" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: "test-results/admin-mobile-drawer.png", fullPage: true });
  await page.keyboard.press("Escape");
  await expect(drawer).not.toBeVisible();
  await page.close();
});
