import { expect, test, type Page } from "@playwright/test";
import { E2E, e2eClientHeaders, e2ePassword } from "./staff-fixture";

test.describe.configure({ mode: "serial" });

let page: Page;

async function signIn(page: Page, email: string = E2E.approver.email) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    extraHTTPHeaders: e2eClientHeaders(30),
  });
  await signIn(page);
});

test.afterAll(async () => {
  await page.close();
});

test("approver dashboard and queue use scoped live data and validated filters", async () => {
  await expect(page.getByRole("heading", { name: "Your review workspace" })).toBeVisible();
  await expect(page.locator(".header-user")).toContainText("Reese Approver");
  await expect(page.locator(".header-user")).toContainText("Approver");
  await expect(page.getByText("Authenticated session")).toHaveCount(0);
  await expect(page.getByText("Assigned pending reviews")).toBeVisible();
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  await expect(navigation.getByText("Review Requests")).toBeVisible();
  await expect(navigation.getByText("My Requests")).toHaveCount(0);
  await expect(navigation.getByText("Request Access")).toHaveCount(0);
  await page.screenshot({
    path: "test-results/staff-dashboard-desktop.png",
    fullPage: true,
  });

  await navigation.getByText("Review Requests").click();
  await expect(page.getByRole("heading", { name: "Review requests" })).toBeVisible();
  await expect(page.getByRole("row", { name: /E2E-APPROVE/ })).toBeVisible();
  await expect(page.getByText("E2E-OTHER")).toHaveCount(0);
  await page.screenshot({
    path: "test-results/staff-review-queue-desktop.png",
    fullPage: true,
  });
  await page.getByLabel("Search").fill("E2E-RETRY");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page).toHaveURL(/search=E2E-RETRY/);
  await expect(page.getByRole("row", { name: /E2E-RETRY/ })).toBeVisible();
  await expect(page.getByText("E2E-APPROVE")).toHaveCount(0);
  await page.goto("/review?resource=r-lms");
  await expect(page.getByRole("heading", { name: "No reviews to show" })).toBeVisible();
  await page.goto("/review?pageSize=999&status=not-a-status");
  await expect(
    page.getByRole("alert").filter({ hasText: "Filters could not be applied" }),
  ).toBeVisible();
});

test("detail is sanitized and another approver's identifier is indistinguishable", async () => {
  await page.goto(`/review/${E2E.requests.retry}`);
  await expect(page.getByRole("heading", { name: "Review access request" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sam Requester" })).toBeVisible();
  await expect(page.getByText("Low sensitivity")).toBeVisible();
  await expect(page.getByText("Access request submitted.")).toBeVisible();
  await expect(
    page.locator("main").getByText(/password|credential record|session token/i),
  ).toHaveCount(0);
  await page.screenshot({
    path: "test-results/staff-review-detail-desktop.png",
    fullPage: true,
  });

  await page.goto(`/review/${E2E.requests.anotherApprover}`);
  await expect(page.getByRole("heading", { name: "We couldn’t find that page" })).toBeVisible();
  await page.goto("/review/e2000000-0000-4000-8000-999999999999");
  await expect(page.getByRole("heading", { name: "We couldn’t find that page" })).toBeVisible();
});

test("decision dialog validates reasons, prevents duplicate clicks, and reuses its idempotency key", async () => {
  await page.goto(`/review/${E2E.requests.retry}`);
  await page.getByRole("button", { name: "Deny", exact: true }).click();
  await expect(page.getByText("Enter a reason before continuing.")).toBeVisible();
  await expect(page.getByLabel("Decision reason")).toBeFocused();

  await page.getByLabel("Decision reason").fill("  The assignment needs clarification.  ");
  const keys: string[] = [];
  let calls = 0;
  let releaseResponse: () => void = () => undefined;
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  await page.route(`**/api/review/requests/${E2E.requests.retry}/decision`, async (route) => {
    calls += 1;
    keys.push(route.request().headers()["idempotency-key"] ?? "");
    if (calls === 1) await responseGate;
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "service_unavailable" } }),
    });
  });
  await page.getByRole("button", { name: "Deny", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Deny access" });
  await expect(dialog).toBeVisible();
  await page.screenshot({
    path: "test-results/staff-decision-dialog.png",
    fullPage: true,
  });
  const confirm = dialog.getByRole("button", { name: "Confirm decision" });
  await confirm.click();
  const saving = dialog.getByRole("button", { name: "Saving…" });
  await expect(saving).toBeDisabled();
  await saving.click({ force: true });
  expect(calls).toBe(1);
  releaseResponse();
  await expect(dialog.getByText(/temporarily unavailable/)).toBeVisible();
  await confirm.click();
  await expect.poll(() => calls).toBe(2);
  expect(keys[0]).toBeTruthy();
  expect(keys[1]).toBe(keys[0]);
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect(page.getByLabel("Decision reason")).toHaveValue(
    "  The assignment needs clarification.  ",
  );
  await page.unroute(`**/api/review/requests/${E2E.requests.retry}/decision`);

  await page.getByRole("button", { name: "Return for revision" }).click();
  await expect(page.getByRole("dialog", { name: "Return for revision" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Return for revision" })).toBeFocused();
});

test("stale decisions refresh safely while preserving entered text", async () => {
  await page.goto(`/review/${E2E.requests.stale}`);
  await page.getByLabel("Decision reason").fill("Please revise the requested dates.");
  await page.route(`**/api/review/requests/${E2E.requests.stale}/decision`, (route) =>
    route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "stale_decision" } }),
    }),
  );
  await page.getByRole("button", { name: "Return for revision" }).click();
  await page.getByRole("button", { name: "Confirm decision" }).click();
  await expect(page.getByText(/another decision changed/i).first()).toBeVisible();
  await expect(page.getByLabel("Decision reason")).toHaveValue(
    "Please revise the requested dates.",
  );
  await page.unroute(`**/api/review/requests/${E2E.requests.stale}/decision`);
});

test("confirmed approval records a decision without claiming activation", async () => {
  await page.goto(`/review/${E2E.requests.approve}`);
  const approve = page.getByRole("button", { name: "Approve", exact: true });
  await approve.click();
  await expect(page.getByRole("dialog")).toContainText("does not grant or activate access");
  await page.keyboard.press("Escape");
  await expect(approve).toBeFocused();
  await approve.click();
  await page.getByRole("button", { name: "Confirm decision" }).click();
  await expect(page.getByText("Approved — awaiting activation").first()).toBeVisible();
  await expect(page.getByText("No decision controls available")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Immutable decision history" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Deny", exact: true })).toHaveCount(0);

  await page.goto("/review");
  const terminalRow = page.getByRole("row", { name: /E2E-APPROVE/ });
  await expect(terminalRow).toContainText("Approved — awaiting activation");
  await expect(
    terminalRow.getByRole("link", { name: "View details E2E-APPROVE" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("row", { name: /E2E-RETRY/ })
      .getByRole("link", { name: "Review E2E-RETRY" }),
  ).toBeVisible();
});

for (const width of [768, 390, 320]) {
  test(`staff queue and mobile navigation fit ${width}px without document overflow`, async () => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/review");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(page.getByRole("dialog", { name: "Your workspace" })).toBeVisible();
    await expect(page.getByText("Review Requests").last()).toBeVisible();
    await page.screenshot({
      path: `test-results/staff-review-${width}.png`,
      fullPage: true,
    });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
}

test("only administrators can view unassigned routing failures", async () => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/admin/unassigned");
  await expect(page).toHaveURL(/\/dashboard\?unavailable=administrator/);
  await page.getByRole("button", { name: "Log out" }).click();
  await signIn(page, E2E.administrator.email);
  await expect(page.locator(".header-user")).toContainText("Avery Administrator");
  await expect(page.locator(".header-user")).toContainText("Administrator");
  await expect(page.getByText("Authenticated session")).toHaveCount(0);
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  await expect(navigation.getByText("Unassigned Requests")).toBeVisible();
  await expect(navigation.getByText("Audit Logs")).toBeVisible();
  await expect(navigation.getByText("My Requests")).toHaveCount(0);
  await page.goto("/admin/unassigned");
  await expect(page.getByRole("heading", { name: "Unassigned requests" })).toBeVisible();
  await expect(page.getByText("E2E-UNASSIGNED")).toBeVisible();
  await expect(page.getByText(/cannot be decided until/i).first()).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Unassigned requests table" }).getByRole("link"),
  ).toHaveCount(0);
  await page.screenshot({
    path: "test-results/admin-unassigned-desktop.png",
    fullPage: true,
  });
});

test("administrator without responsibility gets a setup link, not review navigation", async () => {
  await page.getByRole("button", { name: "Log out" }).click();
  await signIn(page, E2E.activationAdministrator.email);

  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  await expect(navigation.getByText("Review Requests")).toHaveCount(0);
  await expect(
    page.getByText("No approval responsibility configured", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Configure an approver responsibility" }).click();
  await expect(page).toHaveURL(/\/admin\/responsibilities$/);
  await expect(
    page.getByRole("heading", { name: "Approver responsibilities" }),
  ).toBeVisible();

  await page.goto("/review");
  await expect(page).toHaveURL(/\/dashboard\?unavailable=approver/);
});
