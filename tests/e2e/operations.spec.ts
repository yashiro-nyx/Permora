import { expect, test, type Page } from "@playwright/test";
import { E2E, e2eClientHeaders, e2ePassword } from "./staff-fixture";

test.describe.configure({ mode: "serial" });

let requester: Page;
let admin: Page;
let approver: Page;

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test.beforeAll(async ({ browser }) => {
  requester = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    extraHTTPHeaders: e2eClientHeaders(10),
  });
  admin = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    extraHTTPHeaders: e2eClientHeaders(11),
  });
  approver = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    extraHTTPHeaders: e2eClientHeaders(12),
  });
  await signIn(requester, E2E.requester.email);
  await signIn(admin, E2E.administrator.email);
  await signIn(approver, E2E.approver.email);
});

test.afterAll(async () => {
  await requester.close();
  await admin.close();
  await approver.close();
});

test("requester notification center filters and marks persisted records read", async () => {
    await requester.goto("/notifications");
    await expect(requester.getByRole("heading", { name: "Notifications" })).toBeVisible();
    await expect(requester.getByRole("heading", { name: "Request approved — awaiting activation" })).toBeVisible();
    await expect(requester.getByRole("heading", { name: "Access request denied" })).toBeVisible();
    await expect(requester.getByText("E2E-NOTIFY-APPROVED")).toBeVisible();
    await expect(requester.getByText("In-app records only")).toBeVisible();
    const mark = requester.getByRole("button", {
      name: /Mark as read.*Access request denied/,
    });
    await mark.press("Enter");
    await expect(requester.getByText("Notification updated")).toBeVisible();
    await requester.getByRole("link", { name: /Unread/ }).click();
    await expect(requester.getByRole("heading", { name: "Access request denied" })).toHaveCount(0);
    await expect(requester.getByRole("heading", { name: "Request approved — awaiting activation" })).toBeVisible();
});

test("administrator audit log is read-only, filtered, and role protected", async () => {
    await admin.goto("/audit");
    await expect(admin.getByRole("heading", { name: "Audit logs" })).toBeVisible();
    await expect(admin.getByRole("region", { name: "Audit log table" })).toContainText("E2E-NOTIFY-APPROVED");
    await expect(admin.getByText("Immutable and read-only")).toBeVisible();
    await expect(admin.getByRole("button", { name: /delete|edit/i })).toHaveCount(0);
    await admin.getByLabel("Event type").selectOption("review_approved");
    await admin.getByRole("button", { name: "Apply filters" }).click();
    await expect(admin).toHaveURL(/eventType=review_approved/);
    await expect(admin.getByText(/access is still awaiting activation/)).toBeVisible();

    await approver.goto("/audit");
    await expect(approver).toHaveURL(/\/dashboard\?unavailable=administrator/);
});

test("notification and audit layouts avoid overflow at tablet and narrow widths", async () => {
  for (const [page, route] of [[requester, "/notifications"], [admin, "/audit"]] as const) {
      for (const width of [768, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(route);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
        if (width <= 390) {
          await page.getByRole("button", { name: "Open navigation" }).click();
          await expect(page.getByRole("dialog", { name: "Your workspace" })).toBeVisible();
          await page.keyboard.press("Escape");
        }
      }
  }
});
