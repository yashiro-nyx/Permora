import { expect, test, type Page } from "@playwright/test";
import { E2E, e2eClientHeaders, signIn } from "./staff-fixture";

test.describe.configure({ mode: "serial" });

let admin: Page;
let approver: Page;

test.beforeAll(async ({ browser }) => {
  admin = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    extraHTTPHeaders: e2eClientHeaders(41),
  });
  approver = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    extraHTTPHeaders: e2eClientHeaders(42),
  });
  await signIn(admin, E2E.administrator.email);
  await signIn(approver, E2E.approver.email);
});

test.afterAll(async () => {
  await admin.close();
  await approver.close();
});

test("non-administrators cannot reach the reports dashboard", async () => {
  await approver.goto("/reports");
  await expect(approver).toHaveURL(/\/dashboard\?unavailable=administrator/);
});

test("administrator reports dashboard renders live aggregated metrics", async () => {
  await admin.goto("/reports");
  await expect(
    admin.getByRole("heading", { name: "Reports & analytics" }),
  ).toBeVisible();

  // Headline sections are present and distinguish approval from activation.
  await expect(admin.getByRole("heading", { name: "Requests", exact: true })).toBeVisible();
  await expect(
    admin.getByRole("heading", { name: "Activation & entitlements" }),
  ).toBeVisible();
  await expect(admin.getByText("Approved (pending activation)")).toBeVisible();
  await expect(admin.getByText("Activated", { exact: true })).toBeVisible();

  // The seeded fixture includes requests, so the status breakdown is shown.
  await expect(admin.getByRole("heading", { name: "Requests by status" })).toBeVisible();
  await expect(admin.getByRole("heading", { name: "Approver workload" })).toBeVisible();

  // A generated timestamp confirms the data is computed server-side at load.
  await expect(admin.getByText(/Generated .* Asia\/Manila/)).toBeVisible();
});

test("reports page safely falls back when an invalid date filter is supplied", async () => {
  // The server validates filters via parseReportFilters; a malformed date must
  // not error the page but fall back to the unfiltered summary with a notice.
  await admin.goto("/reports?from=not-a-date");
  await expect(
    admin.getByRole("heading", { name: "Reports & analytics" }),
  ).toBeVisible();
  await expect(admin.getByText("The submitted filters were invalid.")).toBeVisible();
  await expect(admin.getByRole("heading", { name: "Requests", exact: true })).toBeVisible();
});

test("reports filter applies a resource filter through the URL", async () => {
  await admin.goto("/reports");
  await admin.locator("#report-resource").selectOption("r-library");
  await admin.getByRole("button", { name: "Apply filters" }).click();
  await expect(admin).toHaveURL(/[?&]resource=r-library/);
  await expect(
    admin.getByRole("heading", { name: "Reports & analytics" }),
  ).toBeVisible();
});

for (const width of [390, 320]) {
  test(`reports dashboard fits ${width}px without document overflow`, async () => {
    await admin.setViewportSize({ width, height: 900 });
    await admin.goto("/reports");
    expect(
      await admin.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
  });
}
