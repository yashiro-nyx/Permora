import { expect, test, type Page } from "@playwright/test";
import { E2E } from "./staff-fixture";

test.describe.configure({ mode: "serial" });

let requesterPage: Page;
let adminPage: Page;

async function signIn(target: Page, email: string) {
  await target.goto("/login");
  await target.getByLabel("Email address").fill(email);
  await target.getByLabel("Password", { exact: true }).fill(E2E.password);
  await target.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(target).toHaveURL(/\/dashboard$/);
}

test.beforeAll(async ({ browser }) => {
  requesterPage = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  adminPage = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  await signIn(requesterPage, E2E.workflowRequester.email);
  await signIn(adminPage, E2E.administrator.email);
});

test.afterAll(async () => {
  await requesterPage.close();
  await adminPage.close();
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
    requesterPage.getByText(/active entitlement/i),
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
  for (const [target, routes] of [
    [requesterPage, ["/dashboard", "/requests", "/requests/new"]],
    [
      adminPage,
      ["/dashboard", "/review", "/admin/unassigned", "/users"],
    ],
  ] as const) {
    await target.setViewportSize({ width: 320, height: 844 });
    for (const route of routes) {
      await target.goto(route);
      await expect(target.locator("main h1")).toBeVisible();
      expect(
        await target.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
        `${route} should fit a 320px viewport`,
      ).toBe(true);
    }
  }
});
