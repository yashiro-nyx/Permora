import { expect, test, type Page } from "@playwright/test";
import { E2E, e2eClientHeaders, signIn } from "./staff-fixture";

test.describe.configure({ mode: "serial" });

async function assertProfile(page: Page, name: string, label: string) {
  await page.getByRole("button", { name: new RegExp(`${name} profile menu`) }).click();
  const menu = page.getByRole("menu", { name: `${label} profile menu` });
  await expect(menu.getByRole("menuitem", { name: /Account settings/ })).toHaveAttribute("href", "/account/password");
  await expect(menu.getByRole("menuitem", { name: /Notification settings/ })).toHaveAttribute("href", "/account/notifications");
  await expect(menu.getByRole("menuitem", { name: /Help & support/ })).toHaveAttribute("href", "/help");
  await expect(menu.getByRole("button", { name: /Log out/ })).toBeVisible();
  await page.keyboard.press("Escape");
}

for (const [role, email, name, expectedMain] of [
  ["student", E2E.requester.email, "Sam Requester", ["Dashboard", "My Requests", "Request Access"]],
  ["faculty", E2E.faculty.email, "Morgan Faculty", ["Dashboard", "My Requests", "Request Access"]],
  ["approver", E2E.approver.email, "Reese Approver", ["Dashboard", "Review Requests"]],
] as const) {
  test(`${role} has grouped settings and a shared profile menu`, async ({ browser }) => {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
      extraHTTPHeaders: e2eClientHeaders(80 + expectedMain.length),
    });
    await signIn(page, email);
    await page.goto("/account/notifications");
    const navigation = page.getByRole("navigation", { name: "Main navigation" });
    for (const label of expectedMain) await expect(navigation.getByText(label, { exact: true })).toBeVisible();
    await expect(navigation.getByRole("button", { name: "Settings" })).toHaveAttribute("aria-expanded", "true");
    await expect(navigation.getByRole("link", { name: "Notification Preferences" })).toBeVisible();
    await expect(navigation.getByRole("link", { name: "Change Password" })).toBeVisible();
    await expect(page.getByRole("button", { name: /notifications/i })).toBeVisible();
    await assertProfile(page, name, role === "approver" ? "Approver" : role === "faculty" ? "Faculty" : "Student");
    await page.screenshot({ path: `test-results/${role}-unified-navigation.png`, fullPage: true });
    await page.close();
  });
}

test("administrator dashboard exposes live system statistics without replacing operational attention", async ({ browser }) => {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    extraHTTPHeaders: e2eClientHeaders(84),
  });
  await signIn(page, E2E.administrator.email);
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "System statistics" })).toBeVisible();
  await expect(page.getByText("Total requests", { exact: true })).toBeVisible();
  await expect(page.getByText("Active access", { exact: true })).toBeVisible();
  await expect(page.getByText("Scheduled access", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Request trends" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Requests by resource category" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Operational attention" })).toBeVisible();
  await page.screenshot({ path: "test-results/admin-dashboard-statistics.png", fullPage: true });
  await page.close();
});
