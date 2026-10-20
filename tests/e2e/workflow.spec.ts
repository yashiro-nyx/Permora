import { expect, test, type Page } from "@playwright/test";
import { E2E, e2eClientHeaders, signIn } from "./staff-fixture";

test.describe.configure({ mode: "serial" });

let requesterPage: Page;
let adminPage: Page;
let approverPage: Page;
let activationAdminPage: Page;

function dateInput(daysFromToday: number) {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + daysFromToday);
  return value.toISOString().slice(0, 10);
}

test.beforeAll(async ({ browser }) => {
  requesterPage = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    extraHTTPHeaders: e2eClientHeaders(40),
  });
  adminPage = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    extraHTTPHeaders: e2eClientHeaders(41),
  });
  approverPage = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    extraHTTPHeaders: e2eClientHeaders(43),
  });
  activationAdminPage = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    extraHTTPHeaders: e2eClientHeaders(42),
  });
  await signIn(adminPage, E2E.administrator.email);
  await signIn(approverPage, E2E.otherApprover.email);
  await signIn(activationAdminPage, E2E.activationAdministrator.email);
});

test.afterAll(async () => {
  await requesterPage.close();
  await adminPage.close();
  await approverPage.close();
  await activationAdminPage.close();
});

test("request submission, deterministic routing, approval, and requester status stay connected", async ({ browser }, testInfo) => {
  await requesterPage.close();
  requesterPage = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    extraHTTPHeaders: e2eClientHeaders(40),
  });
  const workflowRequester =
    E2E.workflowRequesters[testInfo.repeatEachIndex];
  if (!workflowRequester)
    throw new Error(
      `No workflow requester fixture for repeat ${testInfo.repeatEachIndex + 1}.`,
    );
  await signIn(requesterPage, workflowRequester.email);
  // Keep the Admin queue open before approval. It must refresh its
  // server-rendered data after the separate Approver session approves.
  await activationAdminPage.goto("/admin/activations");
  await expect(
    activationAdminPage.getByRole("heading", { name: "Activations" }),
  ).toBeVisible();
  await requesterPage.goto("/requests/new");
  await requesterPage
    .getByLabel("Select resource")
    .selectOption("r-library");
  await requesterPage
    .getByLabel("Justification / purpose")
    .fill(
      "Access to subscribed materials for an independent literature review.",
    );
  const startsOn = dateInput(1);
  const expiresOn = dateInput(29);
  await requesterPage.getByLabel("Access starts").fill(startsOn);
  await requesterPage.getByLabel("Expiration date").fill(expiresOn);
  await requesterPage
    .getByRole("button", { name: "Review request" })
    .click();
  await expect(
    requesterPage.getByRole("dialog", {
      name: "Submit this access request?",
    }),
  ).toBeVisible();
  await requesterPage
    .getByRole("button", { name: "Submit request" })
    .click();
  await expect(requesterPage).toHaveURL(
    /\/requests\/[0-9a-f-]+\?submitted=1/,
  );
  const submittedToast = requesterPage
    .getByTestId("toast-viewport")
    .getByText("Request submitted");
  await expect(submittedToast).toBeVisible();
  await expect(submittedToast).toHaveCount(0, { timeout: 6500 });
  const requestId = new URL(requesterPage.url()).pathname.split("/").pop();
  expect(requestId).toBeTruthy();
  const headingPath = await requesterPage.locator(".page-heading .breadcrumb").textContent();
  const displayId = headingPath?.match(/REQ-\d{4}-\d{6}/)?.[0];
  expect(displayId).toBeTruthy();
  await expect(requesterPage.locator(".alert.tone-success")).toContainText(
    "assigned for review",
  );
  await expect(
    requesterPage.getByText("Pending review").first(),
  ).toBeVisible();

  await approverPage.goto(`/review/${requestId}`);
  await expect(
    approverPage.getByRole("heading", { name: "Review access request" }),
  ).toBeVisible();
  await expect(
    approverPage.getByRole("heading", { name: "Taylor Workflow" }),
  ).toBeVisible();
  await approverPage
    .getByLabel("Decision reason")
    .fill(
      "The requested resource and validity period meet the current policy.",
    );
  await approverPage
    .getByRole("button", { name: "Approve", exact: true })
    .click();
  await approverPage
    .getByRole("button", { name: "Confirm decision" })
    .click();
  await expect(
    approverPage.getByText("Approved — awaiting provisioning").first(),
  ).toBeVisible();
  await expect(
    approverPage.getByText(/does not activate access, create an entitlement/i),
  ).toBeVisible();

  await requesterPage.reload();
  await expect(
    requesterPage.getByText("Approved — awaiting provisioning").first(),
  ).toBeVisible();
  await expect(
    requesterPage.getByText("Approval decision recorded"),
  ).toBeVisible();
  await expect(
    requesterPage.getByText(/lifecycle status above reflects/i),
  ).toBeVisible();

  await requesterPage.goto("/requests");
  const approvedRow = requesterPage.getByRole("row", {
    name: new RegExp(displayId!),
  });
  const formatDate = (value: string) =>
    new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${value}T00:00:00Z`));
  await expect(approvedRow).toContainText(formatDate(startsOn));
  await expect(approvedRow).toContainText(formatDate(expiresOn));
  await expect(approvedRow).toContainText("Approved — awaiting provisioning");
  await expect(
    requesterPage.getByRole("region", { name: "Request summary" }),
  ).toContainText("Approval recorded; provisioning tracked separately");

  const activationTable = activationAdminPage.getByRole("region", {
    name: "Activation lifecycle table",
  });
  const activationRow = activationTable.getByRole("row", {
    name: new RegExp(displayId!),
  });
  await expect(activationRow).toContainText("Approved — awaiting provisioning");
  await activationRow.getByText("Start activation", { exact: true }).click();
  await activationRow
    .getByLabel("I confirm the requested access was provisioned.")
    .check();
  await activationRow.getByLabel("External reference").fill("E2E-MANUAL-WORKFLOW");
  await activationAdminPage.screenshot({
    path: testInfo.outputPath("admin-activation-form-desktop.png"),
    fullPage: true,
  });
  await activationAdminPage.setViewportSize({ width: 390, height: 844 });
  await activationAdminPage.screenshot({
    path: testInfo.outputPath("admin-activation-form-mobile.png"),
    fullPage: true,
  });
  await activationAdminPage.setViewportSize({ width: 1440, height: 1000 });
  await activationRow.getByRole("button", { name: "Record activation" }).click();
  // The confirmation is surfaced at the queue level (the "Activation outcome"
  // banner) so it survives the refresh that transitions this row to a terminal
  // "Active" state. Scope to that banner specifically: the same confirmation
  // text can also appear in the in-row status, so a page-wide text match would
  // be ambiguous under strict mode.
  await expect(
    activationAdminPage
      .getByRole("status")
      .filter({ hasText: "Activation outcome" }),
  ).toContainText("Access activation recorded.");
  await expect(
    activationAdminPage.locator(`#activation-request-${requestId}`),
  ).toContainText("Provisioned — scheduled start");

  await requesterPage.goto(`/requests/${requestId}`);
  await expect(
    requesterPage
      .getByLabel("Current access status")
      .getByText("Provisioned — scheduled start", { exact: true }),
  ).toBeVisible();
  await expect(
    requesterPage.getByLabel("Current access status").locator(".badge"),
  ).toHaveCount(1);
  await expect(requesterPage.locator(".activation-status-card .badge")).toHaveCount(0);
  await expect(requesterPage.getByText("Approval decision: Approved")).toBeVisible();
  await expect(
    requesterPage.getByLabel("Current access status"),
  ).not.toContainText("Approved — awaiting activation");
  await requesterPage.screenshot({
    path: testInfo.outputPath("student-request-detail.png"),
    fullPage: true,
  });
  await requesterPage.goto("/requests");
  await expect(
    requesterPage.getByRole("row", { name: new RegExp(displayId!) }),
  ).toContainText("Provisioned — scheduled start");
  await requesterPage.screenshot({
    path: testInfo.outputPath("student-request-list.png"),
    fullPage: true,
  });
  await approverPage.goto("/review");
  await expect(
    approverPage.getByRole("row", { name: new RegExp(displayId!) }),
  ).toContainText("Provisioned — scheduled start");
  await approverPage.screenshot({
    path: testInfo.outputPath("approver-review-list.png"),
    fullPage: true,
  });
  await approverPage.goto(`/review/${requestId}`);
  await expect(
    approverPage.getByRole("heading", { name: "Approval decision history" }),
  ).toBeVisible();
  await expect(approverPage.getByText("Approval decision: Approved")).toBeVisible();
  await expect(
    approverPage.getByText("Provisioned — scheduled start", { exact: true }).first(),
  ).toBeVisible();
  await approverPage.screenshot({
    path: testInfo.outputPath("approver-request-detail.png"),
    fullPage: true,
  });
  await requesterPage.goto("/notifications");
  await expect(
    requesterPage.getByRole("heading", { name: "Access provisioned — scheduled start" }),
  ).toBeVisible();
});

test("server role boundaries keep requester and administrator routes separate", async () => {
  await requesterPage.goto("/admin/unassigned");
  await expect(requesterPage).toHaveURL(
    /\/dashboard\?unavailable=administrator/,
  );
  await requesterPage.goto("/users");
  await expect(requesterPage).toHaveURL(
    /\/dashboard\?unavailable=administrator/,
  );
  await requesterPage.goto("/admin/activations");
  await expect(requesterPage).toHaveURL(
    /\/dashboard\?unavailable=administrator/,
  );

  await adminPage.goto("/admin/unassigned");
  await expect(
    adminPage.getByRole("heading", { name: "Unassigned requests" }),
  ).toBeVisible();
  await expect(
    adminPage.getByRole("row", { name: /E2E-UNASSIGNED/ }),
  ).toBeVisible();
  await adminPage.goto("/users");
  await expect(
    adminPage.getByRole("heading", { name: "User management" }),
  ).toBeVisible();
  await expect(adminPage.getByLabel("Search accounts")).toBeVisible();
  await expect(
    adminPage.getByRole("link", { name: "Create user" }),
  ).toBeVisible();
});

test("current requester and administrator pages remain responsive", async () => {
  for (const width of [1440, 390, 320]) {
    for (const [target, routes] of [
      [requesterPage, ["/dashboard", "/requests", "/requests/new"]],
      [
        adminPage,
        ["/dashboard", "/review", "/admin/unassigned", "/users"],
      ],
    ] as const) {
      await target.setViewportSize({ width, height: 844 });
      for (const route of routes) {
        await target.goto(route);
        await expect(target.locator("main h1")).toBeVisible();
        expect(
          await target.evaluate(
            () =>
              document.documentElement.scrollWidth <=
              document.documentElement.clientWidth,
          ),
          `${route} should fit a ${width}px viewport`,
        ).toBe(true);
      }
    }
  }
});
