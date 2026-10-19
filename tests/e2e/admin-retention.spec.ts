import { expect, test, type Page } from "@playwright/test";
import { E2E, e2eClientHeaders, signIn } from "./staff-fixture";

test.describe.configure({ mode: "serial" });

let admin: Page;
let approver: Page;

test.beforeAll(async ({ browser }) => {
  admin = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    extraHTTPHeaders: e2eClientHeaders(61),
  });
  approver = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    extraHTTPHeaders: e2eClientHeaders(62),
  });
  await signIn(admin, E2E.administrator.email);
  await signIn(approver, E2E.approver.email);
});

test.afterAll(async () => {
  await admin.close();
  await approver.close();
});

test("non-administrators cannot reach retention management", async () => {
  await approver.goto("/admin/retention");
  await expect(approver).toHaveURL(/\/dashboard\?unavailable=administrator/);
});

test("retention management lists provisional policies and marks immutable classes", async () => {
  await admin.goto("/admin/retention");
  await expect(
    admin.getByRole("heading", { name: "Retention management" }),
  ).toBeVisible();
  await expect(admin.getByText("Preview only — no data is changed")).toBeVisible();

  // Immutable accountability class is shown and not previewable.
  const auditRow = admin.getByRole("row", { name: /audit_event/ });
  await expect(auditRow).toBeVisible();
  await expect(auditRow).toContainText("Immutable");
  await expect(auditRow).toContainText("Not archivable");

  // A provisional class with a retention window exposes a preview control.
  const notificationRow = admin.getByRole("row", { name: /user_notification/ });
  await expect(notificationRow).toContainText("Provisional");
  await expect(notificationRow.getByRole("button", { name: /Run a retention preview/ })).toBeVisible();
});

test("running a dry-run preview reports a non-destructive result", async () => {
  await admin.goto("/admin/retention");
  const notificationRow = admin.getByRole("row", { name: /user_notification/ });
  await notificationRow.getByRole("button", { name: /Run a retention preview/ }).click();
  const result = notificationRow.getByRole("status");
  await expect(result).toBeVisible();
  // Whatever the count, the result must state no records were changed, or that
  // there are no eligible records — never a destructive confirmation.
  await expect(result).toContainText(/No eligible records|would match/);
});

for (const width of [390, 320]) {
  test(`retention management fits ${width}px without document overflow`, async () => {
    await admin.setViewportSize({ width, height: 900 });
    await admin.goto("/admin/retention");
    expect(
      await admin.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
  });
}
