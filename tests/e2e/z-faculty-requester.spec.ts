import { expect, test, type Page } from "@playwright/test";
import { E2E, e2eClientHeaders, signIn } from "./staff-fixture";

test.describe.configure({ mode: "serial" });

let faculty: Page;
let approver: Page;
let administrator: Page;

function dateInput(daysFromToday: number) {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + daysFromToday);
  return value.toISOString().slice(0, 10);
}

test.beforeAll(async ({ browser }) => {
  faculty = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    extraHTTPHeaders: e2eClientHeaders(60),
  });
  approver = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    extraHTTPHeaders: e2eClientHeaders(61),
  });
  administrator = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    extraHTTPHeaders: e2eClientHeaders(62),
  });
  await signIn(faculty, E2E.faculty.email);
  await signIn(approver, E2E.approver.email);
  await signIn(administrator, E2E.administrator.email);
});

test.afterAll(async () => {
  await faculty.close();
  await approver.close();
  await administrator.close();
});

test("faculty receives eligible requester workflow and preserves role boundaries", async () => {
  await faculty.goto("/dashboard");
  await expect(faculty.locator(".header-user")).toContainText("Morgan Faculty");
  await expect(faculty.locator(".header-user")).toContainText("Faculty");
  await expect(faculty.getByRole("heading", { name: /Welcome back/ })).toBeVisible();

  await faculty.goto("/requests/new");
  const resource = faculty.getByLabel("Select resource");
  await expect(resource.locator('option[value="r-faculty-grading"]')).toHaveCount(1);
  await expect(resource.locator('option[value="r-student-portal"]')).toHaveCount(0);
  await resource.selectOption("r-faculty-grading");
  await expect(faculty.getByRole("radio")).toHaveCount(2);
  await expect(faculty.getByLabel("Course and section")).toBeVisible();
  const section = faculty
    .getByLabel("Course and section")
    .locator("option")
    .filter({ hasText: "CS301-A" });
  await expect(section).toHaveCount(1);
  const sectionValue = await section.getAttribute("value");
  expect(sectionValue).toBeTruthy();
  await faculty.getByLabel("Course and section").selectOption(sectionValue!);
  await faculty.getByRole("radio").first().check();
  await faculty.getByLabel("Justification / purpose").fill(
    "Grade entry access for the assigned CS 301 section.",
  );
  await faculty.getByLabel("Access starts").fill(dateInput(1));
  await faculty.getByLabel("Expiration date").fill(dateInput(14));
  await faculty.getByRole("button", { name: "Review request" }).click();
  await faculty.getByRole("button", { name: "Submit request" }).click();
  await expect(faculty).toHaveURL(/\/requests\/[0-9a-f-]+\?submitted=1/);

  const requestId = new URL(faculty.url()).pathname.split("/").pop();
  expect(requestId).toBeTruthy();
  await expect(faculty.getByText("Pending review").first()).toBeVisible();
  await expect(
    faculty.getByTestId("toast-viewport").getByText("Request submitted", { exact: true }),
  ).toBeVisible();

  await approver.goto(`/review/${requestId}`);
  await expect(approver.getByRole("heading", { name: "Review access request" })).toBeVisible();
  await approver.getByLabel("Decision reason").fill(
    "The faculty member has a current assignment for the requested section.",
  );
  await approver.getByRole("button", { name: "Approve", exact: true }).click();
  await approver.getByRole("button", { name: "Confirm decision" }).click();
  await expect(approver.getByText("Approved — awaiting provisioning").first()).toBeVisible();

  await faculty.reload();
  await expect(faculty.getByText("Approved — awaiting provisioning").first()).toBeVisible();
  await expect(faculty.getByText("Approval decision recorded")).toBeVisible();

  await administrator.goto("/notifications/staff");
  await expect(administrator.getByText(`Activation ready —`, { exact: false }).first()).toBeVisible();
  await expect(administrator.getByText(/REQ-\d{4}-\d{6}/).first()).toBeVisible();

  await administrator.goto("/admin/activations");
  const row = administrator.getByRole("row", {
    name: /Morgan Faculty.*Faculty Grading System/,
  });
  await expect(row).toBeVisible();
  await row.getByText("Start activation", { exact: true }).click();
  await row.getByLabel("I confirm the requested access was provisioned.").check();
  await row.getByLabel("External reference").fill("E2E-FACULTY-PROVISIONED");
  await row.getByRole("button", { name: "Record activation" }).click();
  await expect(
    administrator.getByRole("status").filter({ hasText: "Activation outcome" }),
  ).toContainText("Access activation recorded.");

  await faculty.goto(`/requests/${requestId}`);
  await expect(
    faculty.getByLabel("Current access status").getByText(
      "Provisioned — scheduled start",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(faculty.getByText("Approval decision: Approved")).toBeVisible();
  await expect(faculty.locator(".activation-status-card .badge")).toHaveCount(0);
  await faculty.goto("/notifications");
  await expect(
    faculty.getByRole("heading", { name: "Access provisioned — scheduled start" }),
  ).toBeVisible();

  await faculty.goto("/admin/activations");
  await expect(faculty).toHaveURL(/\/dashboard\?unavailable=administrator/);
});

for (const width of [320, 390, 768, 1440]) {
  test(`faculty requester surfaces fit ${width}px`, async () => {
    await faculty.setViewportSize({ width, height: 844 });
    for (const route of ["/dashboard", "/requests", "/requests/new"] as const) {
      await faculty.goto(route);
      await expect(faculty.locator("main h1")).toBeVisible();
      expect(
        await faculty.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
        `${route} should fit a ${width}px viewport`,
      ).toBe(true);
    }
  });
}
