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
    extraHTTPHeaders: e2eClientHeaders(31),
  });
  approver = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    extraHTTPHeaders: e2eClientHeaders(32),
  });
  await signIn(admin, E2E.administrator.email);
  await signIn(approver, E2E.approver.email);
});

test.afterAll(async () => {
  await admin.close();
  await approver.close();
});

test("non-administrators cannot reach institutional identifier maintenance", async () => {
  await approver.goto("/admin/identifiers");
  await expect(approver).toHaveURL(/\/dashboard\?unavailable=administrator/);
});

test("administrator searches an account and records then replaces an identifier", async () => {
  await admin.goto("/admin/identifiers");
  await expect(
    admin.getByRole("heading", { name: "Institutional identifier maintenance" }),
  ).toBeVisible();

  // Search the account directory and select the requester account.
  await admin.getByLabel("Search by name or email").fill("Sam Requester");
  await admin.getByRole("button", { name: "Search accounts" }).click();
  const accountRow = admin.getByRole("row", { name: /Sam Requester/ });
  await expect(accountRow).toBeVisible();
  await accountRow.getByRole("button", { name: "Manage identifiers for Sam Requester" }).click();

  await expect(
    admin.getByRole("heading", { name: "Identifiers for Sam Requester" }),
  ).toBeVisible();

  // Create a new student number (lower-case input is normalized to upper-case).
  await admin.locator("#identifier-type").selectOption("student_number");
  await admin.locator("#identifier-issuer").fill("campus-registrar");
  await admin.locator("#identifier-value").fill("e2e-std-01");
  await admin.getByRole("button", { name: "Save identifier" }).click();
  await expect(
    admin.getByRole("status").filter({ hasText: "Update complete" }).filter({ hasText: "Student number saved for Sam Requester." }),
  ).toBeVisible();
  const identifierRow = admin
    .getByRole("region", { name: "Account identifiers" })
    .getByRole("row", { name: /campus-registrar/ });
  await expect(identifierRow).toContainText("E2E-STD-01");
  await expect(identifierRow).toContainText("Student number");

  // Updating the same type + issuer with a new value prompts a replace confirmation.
  await admin.locator("#identifier-type").selectOption("student_number");
  await admin.locator("#identifier-issuer").fill("campus-registrar");
  await admin.locator("#identifier-value").fill("e2e-std-02");
  await admin.getByRole("button", { name: "Save identifier" }).click();
  const confirm = admin.getByRole("dialog", { name: "Replace existing identifier?" });
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText("E2E-STD-01");
  await confirm.getByRole("button", { name: "Replace identifier" }).click();
  await expect(
    admin.getByRole("status").filter({ hasText: "Update complete" }).filter({ hasText: "Student number saved for Sam Requester." }),
  ).toBeVisible();
  const updatedRow = admin
    .getByRole("region", { name: "Account identifiers" })
    .getByRole("row", { name: /campus-registrar/ });
  await expect(updatedRow).toContainText("E2E-STD-02");
  await expect(updatedRow).not.toContainText("E2E-STD-01");
});

for (const width of [390, 320]) {
  test(`identifier maintenance fits ${width}px without document overflow`, async () => {
    await admin.setViewportSize({ width, height: 900 });
    await admin.goto(`/admin/identifiers?q=${encodeURIComponent("Sam Requester")}`);
    expect(
      await admin.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
  });
}
