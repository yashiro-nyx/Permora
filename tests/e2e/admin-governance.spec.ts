import { expect, test, type Page } from "@playwright/test";
import { E2E, e2eClientHeaders, e2ePassword } from "./staff-fixture";

test.describe.configure({ mode: "serial" });

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
  admin = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    extraHTTPHeaders: e2eClientHeaders(21),
  });
  approver = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    extraHTTPHeaders: e2eClientHeaders(22),
  });
  await signIn(admin, E2E.administrator.email);
  await signIn(approver, E2E.approver.email);
});

test.afterAll(async () => {
  await admin.close();
  await approver.close();
});

test("non-administrators cannot reach responsibility or unassigned pages", async () => {
  await approver.goto("/admin/responsibilities");
  await expect(approver).toHaveURL(/\/dashboard\?unavailable=administrator/);
  await approver.goto("/admin/unassigned");
  await expect(approver).toHaveURL(/\/dashboard\?unavailable=administrator/);
});

test("resource-wide responsibilities require confirmation; an added responsibility can be ended", async () => {
  await admin.goto("/admin/responsibilities");
  await expect(admin.getByRole("heading", { name: "Approver responsibilities" })).toBeVisible();
  await admin.getByRole("combobox", { name: /^Approver/ }).selectOption({ label: "Avery Administrator" });
  await admin.getByRole("combobox", { name: /^Resource/ }).selectOption("r-library");
  await admin.getByRole("combobox", { name: "Permission" }).selectOption("library:restricted-collections");

  const resourceWide = admin.getByLabel("Resource-wide responsibility");
  await expect(resourceWide).not.toBeChecked();
  await resourceWide.click();
  const firstDialog = admin.getByRole("dialog", { name: "Confirm resource-wide responsibility" });
  await expect(firstDialog).toBeVisible();
  await firstDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(resourceWide).not.toBeChecked();

  await resourceWide.click();
  await admin.getByRole("dialog", { name: "Confirm resource-wide responsibility" })
    .getByRole("button", { name: "Confirm resource-wide scope" }).click();
  await admin.getByRole("button", { name: "Add responsibility" }).click();
  await expect(admin.getByRole("status").filter({ hasText: "Responsibility added." })).toBeVisible();

  const row = admin.getByRole("row", { name: /Avery Administrator.*Library E-Resources.*Use restricted academic collections.*Resource-wide/ });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "End responsibility for Avery Administrator on Library E-Resources" }).click();
  const endDialog = admin.getByRole("dialog", { name: "End responsibility?" });
  await expect(endDialog).toContainText("cannot be undone");
  await endDialog.getByRole("button", { name: "End responsibility" }).click();
  await expect(admin.getByRole("status").filter({ hasText: "Responsibility ended." })).toBeVisible();
  await expect(row).toContainText("Ended");
});

test("assignment submits the queue version, handles 409 without retry, then resolves pending routing", async () => {
  await admin.goto("/admin/unassigned");
  const row = admin.getByRole("row", { name: /E2E-ASSIGN/ });
  const queuedVersion = Number(await row.getAttribute("data-request-version"));
  expect(Number.isInteger(queuedVersion)).toBe(true);
  await row.getByText("Show eligible assignees").click();
  const assignee = row.getByLabel("Eligible assignee");
  await expect(assignee.locator("option").filter({ hasText: "Reese Approver" })).toHaveCount(1);
  await assignee.selectOption({ label: "Reese Approver" });

  let calls = 0;
  let submittedVersion: unknown;
  const endpoint = `**/api/admin/unassigned-requests/${E2E.requests.assignment}/assign`;
  await admin.route(endpoint, async (route) => {
    calls += 1;
    submittedVersion = JSON.parse(route.request().postData() ?? "{}").expectedVersion;
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "conflict" } }),
    });
  });
  await row.getByRole("button", { name: "Assign request" }).click();
  await expect(row.getByRole("alert")).toContainText("already assigned or changed");
  await expect.poll(() => calls).toBe(1);
  expect(submittedVersion).toBe(queuedVersion);
  await expect(row.getByRole("button", { name: "Refresh eligible assignees" })).toBeVisible();
  await admin.unroute(endpoint);

  await row.getByRole("button", { name: "Refresh eligible assignees" }).click();
  await expect(assignee.locator("option").filter({ hasText: "Reese Approver" })).toHaveCount(1);
  await assignee.selectOption({ label: "Reese Approver" });
  await row.getByRole("button", { name: "Assign request" }).click();
  await expect(admin.getByRole("row", { name: /E2E-ASSIGN/ })).toHaveCount(0);

  const eligibilityResponse = await admin.request.get(
    `/api/admin/unassigned-requests/${E2E.requests.assignment}/assign`,
  );
  expect(eligibilityResponse.ok()).toBe(true);
  expect((await eligibilityResponse.json()).items).toEqual([]);
});

for (const width of [390, 320]) {
  test(`responsibilities and pending routing fit ${width}px without document overflow`, async () => {
    await admin.setViewportSize({ width, height: 900 });
    for (const route of ["/admin/responsibilities", "/admin/unassigned"]) {
      await admin.goto(route);
      expect(await admin.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    }
  });
}