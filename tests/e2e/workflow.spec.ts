import { expect, test, type Page } from "@playwright/test";
import { E2E, e2eClientHeaders, e2ePassword } from "./staff-fixture";

test.describe.configure({ mode: "serial" });

let requesterPage: Page;
let adminPage: Page;
let activationAdminPage: Page;

async function signIn(target: Page, email: string) {
  await target.goto("/login");
  await target.getByLabel("Email address").fill(email);
  await target.getByLabel("Password", { exact: true }).fill(e2ePassword());
  await target.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(target).toHaveURL(/\/dashboard$/);
}

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
  activationAdminPage = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    extraHTTPHeaders: e2eClientHeaders(42),
  });
  await signIn(requesterPage, E2E.workflowRequester.email);
  await signIn(adminPage, E2E.administrator.email);
  await signIn(activationAdminPage, E2E.activationAdministrator.email);
});

test.afterAll(async () => {
  await requesterPage.close();
  await adminPage.close();
  await activationAdminPage.close();
});

test("request submission, deterministic routing, approval, and requester status stay connected", async () => {
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
  const requestId = new URL(requesterPage.url()).pathname.split("/").pop();
  expect(requestId).toBeTruthy();
  const headingPath = await requesterPage.locator(".page-heading .eyebrow").textContent();
  const displayId = headingPath?.match(/REQ-\d{4}-\d{6}/)?.[0];
  expect(displayId).toBeTruthy();
  await expect(requesterPage.locator(".alert.tone-success")).toContainText(
    "assigned for review",
  );
  await expect(
    requesterPage.getByText("Pending review").first(),
  ).toBeVisible();

  await adminPage.goto(`/review/${requestId}`);
  await expect(
    adminPage.getByRole("heading", { name: "Review access request" }),
  ).toBeVisible();
  await expect(
    adminPage.getByRole("heading", { name: "Taylor Workflow" }),
  ).toBeVisible();
  await adminPage
    .getByLabel("Decision reason")
    .fill(
      "The requested resource and validity period meet the current policy.",
    );
  await adminPage
    .getByRole("button", { name: "Approve", exact: true })
    .click();
  await adminPage
    .getByRole("button", { name: "Confirm decision" })
    .click();
  await expect(
    adminPage.getByText("Approved — awaiting activation").first(),
  ).toBeVisible();
  await expect(
    adminPage.getByText(/does not activate access, create an entitlement/i),
  ).toBeVisible();

  await requesterPage.reload();
  await expect(
    requesterPage.getByText("Approved — awaiting activation").first(),
  ).toBeVisible();
  await expect(
    requesterPage.getByText("Request approved — awaiting activation"),
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
  await expect(approvedRow).toContainText("Approved — awaiting activation");
  await expect(
    requesterPage.getByRole("region", { name: "Request summary" }),
  ).toContainText("Approved requests awaiting activation");

  await activationAdminPage.goto("/admin/activations");
  const activationTable = activationAdminPage.getByRole("region", {
    name: "Activation lifecycle table",
  });
  const activationRow = activationTable.getByRole("row", {
    name: new RegExp(displayId!),
  });
  await expect(activationRow).toContainText("Awaiting activation");
  await activationRow.getByText("Start activation", { exact: true }).click();
  await activationRow
    .getByLabel("I confirm the requested access was provisioned.")
    .check();
  await activationRow.getByLabel("External reference").fill("E2E-MANUAL-WORKFLOW");
  await activationRow.getByRole("button", { name: "Record activation" }).click();
  await expect(activationRow.getByRole("status")).toContainText(
    "Access activation recorded.",
  );
  await expect(activationRow).toContainText("Active");

  await requesterPage.goto(`/requests/${requestId}`);
  await expect(requesterPage.getByText("Active", { exact: true })).toBeVisible();
  await expect(requesterPage.getByText("approved pending activation")).toBeVisible();
  await requesterPage.goto("/notifications");
  await expect(
    requesterPage.getByRole("heading", { name: "Access activated" }),
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
  await expect(adminPage.getByText("E2E-UNASSIGNED")).toBeVisible();
  await adminPage.goto("/users");
  await expect(
    adminPage.getByRole("heading", { name: "User management" }),
  ).toBeVisible();
  await expect(
    adminPage.getByText(/no management controls/i),
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
