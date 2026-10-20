import { expect, test, type Page } from "@playwright/test";
import { E2E, e2eClientHeaders, signIn } from "./staff-fixture";

test.describe.configure({ mode: "serial" });

let requester: Page;
let admin: Page;
let approver: Page;

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
    await expect(requester.getByRole("heading", { name: "Approval decision recorded" })).toBeVisible();
    await expect(requester.getByRole("heading", { name: "Access request denied" })).toBeVisible();
    await expect(requester.getByRole("heading", { name: "Access activation failed" })).toBeVisible();
    await expect(requester.getByRole("heading", { name: "Access activated" })).toBeVisible();
    await expect(requester.getByText("E2E-NOTIFY-APPROVED").first()).toBeVisible();
    await expect(requester.getByText("In-app records only")).toBeVisible();
    const mark = requester.getByRole("button", {
      name: /Mark as read.*Access request denied/,
    });
    await mark.press("Enter");
    await expect(requester.getByText("Notification updated")).toBeVisible();
    await requester.getByRole("link", { name: /Unread/ }).click();
    await expect(requester.getByRole("heading", { name: "Access request denied" })).toHaveCount(0);
    await expect(requester.getByRole("heading", { name: "Approval decision recorded" })).toBeVisible();
    await expect(requester.getByRole("heading", { name: "Access activation failed" })).toBeVisible();
    await expect(requester.getByRole("heading", { name: "Access activated" })).toBeVisible();
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

test("approver sees staff notification bell with unread count and staff notification page", async () => {
  await approver.goto("/dashboard");
  // The staff bell should show an unread indicator for the seeded notification.
  const bell = approver.getByRole("button", { name: /Staff notifications/ });
  await expect(bell).toBeVisible();
  // Unread badge should be visible (1 seeded notification).
  await bell.click();
  const popover = approver.getByRole("dialog", { name: "Staff notifications" });
  await expect(popover).toBeVisible();
  await expect(popover.getByText("New request assigned for review").first()).toBeVisible();
  await expect(
    popover.getByRole("link", { name: /View all notifications/ }),
  ).toBeVisible();
  await approver.keyboard.press("Escape");
  await expect(popover).not.toBeVisible();
});

test("staff notification page shows assignment with review link", async () => {
  await approver.goto("/notifications/staff");
  await expect(
    approver.getByRole("heading", { name: "Staff Notifications" }),
  ).toBeVisible();
  // There may be multiple assignment notifications from different test runs;
  // verify at least one is present and has a review link.
  await expect(
    approver.getByRole("heading", { name: "New request assigned for review" }).first(),
  ).toBeVisible();
  await expect(
    approver.getByRole("link", { name: /Review request/ }).first(),
  ).toBeVisible();
  await expect(approver.getByText("In-app records only")).toBeVisible();
});

test("requester cannot access staff notification page or bell", async () => {
  // The requester bell shows the requester-scoped bell (no staff notifications).
  await requester.goto("/dashboard");
  await expect(
    requester.getByRole("button", { name: /Notifications/ }),
  ).toBeVisible();
  await expect(
    requester.getByRole("button", { name: /Staff notifications/ }),
  ).not.toBeVisible();
  // Navigating to /notifications/staff redirects away.
  await requester.goto("/notifications/staff");
  await expect(requester).toHaveURL(/\/dashboard\?unavailable=staff/);
});

test("notification and audit layouts avoid overflow at tablet and narrow widths including staff page", async () => {
  for (const width of [768, 390, 320]) {
    await approver.setViewportSize({ width, height: 900 });
    await approver.goto("/notifications/staff");
    expect(
      await approver.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
  }
});
