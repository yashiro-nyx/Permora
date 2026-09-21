import { expect, test, type Page } from "@playwright/test";
import { E2E } from "./staff-fixture";

test.describe.configure({ mode: "serial" });

let page: Page;

async function signIn(target: Page) {
  await target.goto("/login");
  await target.getByLabel("Email address").fill(E2E.requester.email);
  await target.getByLabel("Password", { exact: true }).fill(E2E.password);
  await target.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(target).toHaveURL(/\/dashboard$/);
}

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await signIn(page);
});

test.afterAll(async () => {
  await page.close();
});

test("request history, filters, and accessible details use persisted records", async () => {
  await page.goto("/requests");
  await expect(
    page.getByRole("heading", { name: "My access requests" }),
  ).toBeVisible();
  await expect(page.locator(".header-user")).toContainText("Sam Requester");
  await expect(page.locator(".header-user")).toContainText("Student");
  await expect(page.getByText("Authenticated session")).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Request summary" }),
  ).toContainText("05");
  await expect(
    page.getByRole("region", { name: "Request summary" }),
  ).toContainText("Approved requests awaiting activation");

  const view = page.locator(
    `button[aria-controls="history-${E2E.requests.retry}"]`,
  );
  await expect(view).toHaveAttribute("aria-expanded", "false");
  await view.focus();
  await page.keyboard.press("Enter");
  await expect(view).toHaveAttribute("aria-expanded", "true");
  const details = page.locator(`#history-${E2E.requests.retry}`);
  await expect(details).toBeVisible();
  await expect(details).toContainText("E2E-RETRY");
  await expect(details).toContainText("Library E-Resources");
  await expect(details).toContainText("capstone literature review");
  await expect(details).toContainText("Request submitted");
  await expect(details).toContainText("Assigned for review");
  const requestRow = page.getByRole("row", { name: /E2E-RETRY/ }).first();
  await expect(requestRow).toContainText("Sep 22, 2026");
  await expect(requestRow).toContainText("Oct 22, 2026");
  await expect(requestRow).not.toContainText(
    "Requested period shown in details",
  );
  await view.press("Space");
  await expect(details).toBeHidden();

  await page.getByLabel("Search requests").fill("E2E-RETRY");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page).toHaveURL(/query=E2E-RETRY/);
  await expect(page.getByRole("row", { name: /E2E-RETRY/ })).toBeVisible();
  await expect(page.getByText("E2E-OTHER")).toHaveCount(0);

  await page.goto("/requests?status=denied");
  await expect(
    page.getByRole("heading", { name: "No requests to show" }),
  ).toBeVisible();
  await page.goto("/requests?resource=r-library");
  await expect(
    page.getByRole("row", { name: /E2E-RETRY/ }).first(),
  ).toBeVisible();
  await page.goto("/requests?from=2099-01-01&to=2099-01-02");
  await expect(
    page.getByRole("heading", { name: "No requests to show" }),
  ).toBeVisible();
});

test("request details enforce requester navigation and expose no staff controls", async () => {
  await page.goto(`/requests/${E2E.requests.retry}`);
  await expect(
    page.getByRole("heading", { name: "Request details", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("E2E-RETRY").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Approve", exact: true }),
  ).toHaveCount(0);
  const navigation = page.getByRole("navigation", {
    name: "Main navigation",
  });
  await expect(navigation.getByText("My Requests")).toBeVisible();
  await expect(navigation.getByText("Request Access")).toBeVisible();
  await expect(navigation.getByText("Review Requests")).toHaveCount(0);

  await page.goto("/review");
  await expect(page).toHaveURL(/\/dashboard\?unavailable=approver/);
});

test("student request form retains server-derived eligibility and validation", async () => {
  await page.goto("/requests/new");
  await expect(
    page.getByRole("heading", { name: "New resource access request" }),
  ).toBeVisible();
  await expect(
    page.locator('#resourceId option[value="r-faculty-grading"]'),
  ).toHaveCount(0);
  await page.getByLabel("Select resource").selectOption("r-library");
  await expect(page.getByRole("radio")).toHaveCount(1);
  await expect(page.getByRole("radio")).toHaveAccessibleName(
    /Use subscribed academic materials/,
  );
  await page.getByRole("button", { name: "Review request" }).click();
  await expect(page.getByLabel("Justification / purpose")).toBeFocused();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("requester pages and login imagery fit desktop and mobile viewports", async ({
  browser,
}) => {
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/requests");
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
    if (width <= 390) {
      await page.getByRole("button", { name: "Open navigation" }).click();
      await expect(
        page.getByRole("dialog", { name: "Your workspace" }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
    }
    await page.screenshot({
      path: `test-results/requester-stage1-${width}.png`,
      fullPage: true,
    });
  }

  const anonymous = await browser.newPage({
    viewport: { width: 390, height: 900 },
  });
  try {
    await anonymous.goto("/login");
    await expect(
      anonymous.locator(".login-blueprint img"),
    ).toHaveJSProperty("complete", true);
    await expect(
      anonymous.locator(".login-blueprint img"),
    ).not.toHaveJSProperty("naturalWidth", 0);
    await expect(anonymous.locator(".login-visual")).toBeHidden();
    expect(
      await anonymous.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
  } finally {
    await anonymous.close();
  }
});
