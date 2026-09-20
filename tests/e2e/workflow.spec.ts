import { test, expect, type Page } from "@playwright/test";
import type { DemoState } from "../../lib/model";

async function saved(page: Page): Promise<DemoState> {
  return page.evaluate(() =>
    JSON.parse(localStorage.getItem("permora-demo-v1")!),
  );
}
async function role(page: Page, value: string) {
  await page.getByLabel("Demo role", { exact: true }).selectOption(value);
  await expect(page).toHaveURL(/dashboard/);
}
async function enter(page: Page) {
  await page.goto("/login");
  await page.evaluate(() => {
    localStorage.removeItem("permora-demo-v1");
    sessionStorage.removeItem("permora-demo-profile");
  });
  await page.reload();
  await page.getByRole("button", { name: "Enter demo workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back, Alex!" }),
  ).toBeVisible();
}

test("request, review, notification, expiration, renewal and audit stay connected", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await enter(page);
  await page.goto("/requests/new");
  await page.getByLabel("Select resource").selectOption("r-research-workspace");
  await page.getByRole("radio", { name: /Contribute project/ }).check();
  await page
    .getByLabel("Research project")
    .fill("PROJECT-2026-014 · Coastal Data Study");
  await page
    .getByLabel("Justification / purpose")
    .fill("Research network access for my final project and coursework.");
  await page.getByLabel("Access starts").fill("2026-09-14");
  await page.getByLabel(/^Expiration date/).fill("2026-09-15");
  await page
    .getByRole("button", { name: "Submit request", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByRole("button", { name: "Confirm request", exact: true })
    .click();
  await expect(page).toHaveURL(/requests\/REQ-/);
  const id = (await saved(page)).requests[0].id;
  expect((await saved(page)).requests[0].status).toBe("pending");
  await role(page, "approver");
  await page.goto(`/requests/${id}`);
  await page
    .getByLabel("Decision reason")
    .fill("The requested permission and duration fit this research project.");
  await page
    .getByRole("button", { name: "Approve request", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirm approval" }).click();
  await expect(page.getByRole("heading", { name: "Next steps" })).toBeVisible();
  expect((await saved(page)).requests[0].status).toBe("approved");
  await role(page, "student");
  await page.goto("/notifications");
  await expect(
    page.getByRole("heading", { name: "Access request approved" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Mark all as read" }).click();
  expect(
    (await saved(page)).notifications
      .filter((n) => n.userId === "u-student")
      .every((n) => n.read),
  ).toBe(true);
  await page.reload();
  await page.goto(`/requests/${id}`);
  await expect(
    page
      .getByText(
        "The requested permission and duration fit this research project.",
      )
      .first(),
  ).toBeVisible();
  await role(page, "admin");
  await page.goto("/permissions");
  await page.getByLabel("Advance by").selectOption("1");
  await page.getByRole("button", { name: "Advance demo clock" }).click();
  await page
    .getByRole("button", { name: "Advance clock", exact: true })
    .click();
  expect((await saved(page)).requests[0].status).toBe("active");
  await page.getByRole("button", { name: "Advance demo clock" }).click();
  await page
    .getByRole("button", { name: "Advance clock", exact: true })
    .click();
  expect((await saved(page)).requests[0].status).toBe("expired");
  await page.goto("/audit");
  await page.getByLabel("Search history").fill(id);
  await expect(
    page.getByRole("cell", { name: "Access expired", exact: true }),
  ).toBeVisible();
  await role(page, "student");
  await page.goto(`/requests/${id}`);
  await page.getByRole("link", { name: "Request renewal" }).click();
  await expect(
    page.getByRole("heading", { name: "Renew resource access" }),
  ).toBeVisible();
  await page.getByLabel("Access starts").fill("2026-10-20");
  await page.getByLabel(/^Expiration date/).fill("2026-10-21");
  await page
    .getByRole("button", { name: "Submit request", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm request", exact: true })
    .click();
  expect((await saved(page)).requests[0].renewalOf).toBe(id);
  expect(errors).toEqual([]);
});

test("validation, filtering, denial, reset, and route visibility", async ({
  page,
}) => {
  await enter(page);
  await page.goto("/requests/new");
  await page
    .getByRole("button", { name: "Submit request", exact: true })
    .click();
  await expect(page.locator(".error-summary")).toContainText("Please check");
  await expect(
    page.locator('#resourceId option[value="r-faculty-grading"]'),
  ).toHaveCount(0);
  await page.getByLabel("Select resource").selectOption("r-library");
  await expect(page.getByRole("radio")).toHaveCount(1);
  await expect(page.getByRole("radio")).toHaveAccessibleName(
    /Use subscribed academic materials/,
  );
  await page.goto("/requests");
  await page
    .getByLabel("Search requests", { exact: true })
    .fill("does-not-exist");
  await expect(
    page.getByRole("heading", { name: "No requests to show" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(
    page.getByRole("button", { name: "Previous page" }),
  ).toBeEnabled();
  await page.goto("/users");
  await expect(
    page.getByRole("heading", {
      name: "This view belongs to another demo role",
    }),
  ).toBeVisible();
  await role(page, "approver");
  await page.goto("/requests/REQ-2026-1042");
  await page
    .getByLabel("Decision reason")
    .fill("Please complete the prerequisite lab training first.");
  await page.getByRole("button", { name: "Deny access", exact: true }).click();
  await page.getByRole("button", { name: "Confirm denial" }).click();
  expect(
    (await saved(page)).requests.find((r) => r.id === "REQ-2026-1042")?.status,
  ).toBe("denied");
  await role(page, "student");
  await page.goto("/notifications");
  await expect(
    page.getByRole("heading", { name: "Access request denied" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reset demo", exact: true }).click();
  await page
    .getByRole("button", { name: "Reset demo data", exact: true })
    .click();
  expect(
    (await saved(page)).requests.find((r) => r.id === "REQ-2026-1042")?.status,
  ).toBe("pending");
});

test("catalog permissions, requester eligibility, scope clearing, and renewal prefill", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await enter(page);
  await page.goto("/requests/new");
  await expect(
    page.locator('#resourceId option[value="r-faculty-grading"]'),
  ).toHaveCount(0);
  await page.getByLabel("Select resource").selectOption("r-lab");
  await page
    .getByRole("textbox", { name: /^Laboratory/ })
    .fill("Computer Laboratory 2");
  await page.getByLabel("Software or environment").fill("MATLAB");
  await page.getByRole("radio", { name: /approved course software/i }).check();
  await page.screenshot({
    path: "test-results/mobile-catalog-form.png",
    fullPage: true,
  });
  await page.getByLabel("Select resource").selectOption("r-research-workspace");
  await expect(page.getByRole("textbox", { name: /^Laboratory/ })).toHaveCount(
    0,
  );
  await expect(page.getByLabel("Research project")).toHaveValue("");
  await expect(
    page.getByRole("radio", { name: /View project files/i }),
  ).toBeChecked();
  await page.getByLabel("Select resource").selectOption("r-student-portal");
  await expect(page.getByText(/fixed to Alex Morgan/)).toBeVisible();
  await expect(page.getByLabel("Research project")).toHaveCount(0);

  await role(page, "faculty");
  await page.goto("/requests/new");
  await expect(
    page.locator('#resourceId option[value="r-faculty-grading"]'),
  ).toHaveCount(1);
  await page.getByLabel("Select resource").selectOption("r-faculty-grading");
  await expect(
    page.getByRole("radio", { name: /Encode grades for assigned section/i }),
  ).toBeChecked();
  await page
    .getByRole("button", { name: "Submit request", exact: true })
    .click();
  await expect(page.locator("#courseSection-error")).toContainText(
    "Course and section is required",
  );
  await expect(
    page.getByText(/cannot verify a teaching assignment/i),
  ).toBeVisible();

  await role(page, "student");
  await page.goto("/requests/new?renew=REQ-2026-1038");
  await expect(page.getByLabel("Select resource")).toHaveValue("r-lab");
  await expect(page.getByLabel("Select resource")).toBeDisabled();
  await expect(page.getByRole("textbox", { name: /^Laboratory/ })).toHaveValue(
    "Robotics Laboratory",
  );
  await expect(page.getByLabel("Software or environment")).toHaveValue(
    "Standard laboratory environment",
  );
  await expect(
    page.getByRole("radio", { name: /designated laboratory account/i }),
  ).toBeChecked();
  await page.goto("/requests/REQ-2026-1042");
  await expect(page.getByText("Computer Laboratory 2")).toBeVisible();
  await expect(page.getByText("Robotics Toolkit")).toBeVisible();
  await expect(page.getByText("Use approved course software")).toBeVisible();
});

test("administrator editors, policy revocation and exports are functional", async ({
  page,
}) => {
  await enter(page);
  await role(page, "admin");
  await page.goto("/users");
  await page.getByRole("button", { name: "Add new user" }).click();
  await page.getByLabel("Full name").fill("Demo Tester");
  await page.getByLabel(/^Email/).fill("tester@demo.permora.test");
  await page.getByLabel(/^Department/).fill("Research");
  await page.getByRole("button", { name: "Review changes" }).click();
  await page.getByRole("button", { name: "Save user", exact: true }).click();
  await page.getByLabel("Search directory").fill("Demo Tester");
  await expect(
    page.getByRole("cell", { name: /Demo Tester/ }).first(),
  ).toBeVisible();
  await page.goto("/resources");
  await page
    .getByRole("button", { name: "Manage Library E-Resources" })
    .click();
  await page.getByLabel("Resource online and available").uncheck();
  await page.getByRole("button", { name: "Review policy" }).click();
  await page.getByRole("button", { name: "Apply policy" }).click();
  expect(
    (await saved(page)).requests.find((r) => r.resourceId === "r-library")
      ?.status,
  ).toBe("revoked");
  await page.goto("/audit");
  await page.getByLabel("Search history").fill("Resource policy updated");
  await expect(
    page.getByRole("cell", { name: "Resource policy updated", exact: true }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export logs" }).click();
  expect((await download).suggestedFilename()).toBe("permora-audit.csv");
});

test("desktop and mobile screens render, fit viewport, and support modal keyboard navigation", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await enter(page);
  await page.screenshot({
    path: "test-results/desktop-dashboard.png",
    fullPage: true,
  });
  for (const route of [
    "/requests",
    "/requests/new",
    "/notifications",
    "/help",
  ]) {
    await page.goto(route);
    await expect(page.locator("main h1")).toBeVisible();
  }
  await role(page, "admin");
  for (const route of [
    "/dashboard",
    "/review",
    "/users",
    "/resources",
    "/permissions",
    "/reports",
    "/audit",
  ]) {
    await page.goto(route);
    await expect(page.locator("main h1")).toBeVisible();
  }
  await page.goto("/resources");
  await page.screenshot({
    path: "test-results/desktop-resources.png",
    fullPage: true,
  });
  await page.goto("/requests/REQ-2026-1042");
  await page.screenshot({
    path: "test-results/desktop-review.png",
    fullPage: true,
  });
  await role(page, "student");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/mobile-dashboard.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() => !!document.activeElement?.closest("dialog")),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open navigation" }),
  ).toBeFocused();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const route of [
      "/dashboard",
      "/requests",
      "/requests/new",
      "/notifications",
    ]) {
      await page.goto(route);
      await expect(page.locator("main h1")).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `${route} at ${await page.evaluate(() => innerWidth)}px`,
      ).toBe(true);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/requests/new");
  await page.screenshot({
    path: "test-results/mobile-form.png",
    fullPage: true,
  });
  await role(page, "admin");
  for (const route of ["/resources", "/reports", "/permissions", "/audit"]) {
    await page.goto(route);
    await expect(page.locator("main h1")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `${route} at ${await page.evaluate(() => innerWidth)}px`,
    ).toBe(true);
  }
  expect(errors).toEqual([]);
});
