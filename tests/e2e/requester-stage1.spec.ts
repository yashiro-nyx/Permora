import { test, expect, type Page } from "@playwright/test";

async function openRequests(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Enter demo workspace" }).click();
  await expect(page).toHaveURL(/dashboard/);
  await page.goto("/requests");
  await expect(
    page.getByRole("heading", { name: "My access requests" }),
  ).toBeVisible();
}

for (const width of [1440, 390, 320]) {
  test(`requester disclosures, filters and renewal at ${width}px`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 1024 });
    await openRequests(page);
    const initial = await page.evaluate(() =>
      localStorage.getItem("permora-demo-v1"),
    );
    const summary = page.getByRole("region", { name: "Request summary" });
    await expect(summary.locator(".metric-value")).toHaveText([
      "06",
      "01",
      "04",
      "01",
    ]);
    await expect(summary).toContainText("2 active · 1 awaiting activation");
    const view = page.getByRole("button", {
      name: "View details for REQ-2026-1041",
    });
    await expect(view.locator("xpath=..").locator(".button")).toHaveCount(1);
    await expect(view).toHaveCSS("font-size", "14px");
    await expect(view).toHaveCSS("font-weight", "600");
    await expect(view).toHaveCSS("white-space", "nowrap");
    await view.hover();
    await expect(view).toHaveCSS("background-color", "rgb(243, 244, 246)");
    await view.focus();
    await expect(view).toHaveCSS("outline-style", "solid");
    await page.keyboard.press("Enter");
    const panel = page.locator('[id="history-REQ-2026-1041"]');
    await expect(panel).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Hide details for REQ-2026-1041" }),
    ).toHaveAttribute("aria-expanded", "true");
    await expect(panel).toContainText("REQ-2026-1041");
    await expect(panel).toContainText("Library E-Resources");
    await expect(panel).toContainText(
      "Access is required for my current research project",
    );
    await expect(panel.locator(".timeline li strong")).toHaveText([
      "Request submitted",
      "Request approved",
      "Access activated",
      "Scheduled expiration",
    ]);
    await expect(panel).toContainText("Planned event, not yet recorded");
    await expect(panel).not.toContainText("Under review");
    if (width < 768) {
      const detailsBox = await panel.locator(".inline-details").boundingBox();
      expect(detailsBox?.x).toBeGreaterThanOrEqual(0);
      expect(
        (detailsBox?.x ?? 0) + (detailsBox?.width ?? 0),
      ).toBeLessThanOrEqual(width);
    }
    await page.screenshot({
      path: `test-results/stage1-requests-${width}.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Hide details for REQ-2026-1041" })
      .press("Space");
    await expect(panel).toBeHidden();
    await page
      .getByLabel("Search requests", { exact: true })
      .fill("REQ-2026-1041");
    await expect(page.locator("tbody > tr:not([hidden])")).toHaveCount(1);
    await expect(summary.locator(".metric-value").first()).toHaveText("06");
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await page.getByLabel("Status", { exact: true }).selectOption("denied");
    await expect(page.locator(".request-denial")).toContainText(
      "network training prerequisite",
    );
    await page.getByLabel("Resource", { exact: true }).selectOption("r-lab");
    await expect(
      page.getByRole("heading", { name: "No requests to show" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await page.getByRole("button", { name: "Date range" }).click();
    await page.getByLabel("Requested from").fill("2026-09-10");
    await page.getByLabel("Requested until").fill("2026-09-10");
    await expect(page.locator("tbody > tr:not([hidden])")).toHaveCount(1);
    await expect(page.locator("tbody")).toContainText("Library E-Resources");
    await page.getByLabel("Requested until").fill("2026-09-09");
    await expect(page.locator("#request-date-error")).toBeVisible();
    await expect(page.getByLabel("Requested until")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await page.getByLabel("Status", { exact: true }).selectOption("approved");
    await expect(page.locator("tbody")).toContainText(
      "Approved · not yet active",
    );
    await page
      .getByRole("button", { name: "View details for REQ-2026-1037" })
      .click();
    const scheduled = page.locator('[id="history-REQ-2026-1037"]');
    await expect(scheduled).not.toContainText("Access activated");
    await expect(scheduled).toContainText("Scheduled expiration");
    await page.getByLabel("Status", { exact: true }).selectOption("expired");
    const expiredRow = page.locator("tr", { hasText: "REQ-2026-1038" }).first();
    const expiredActions = expiredRow.locator(".requester-actions");
    const expiredDetails = expiredActions.locator("button");
    const renew = expiredActions.getByRole("link", {
      name: "Renew REQ-2026-1038",
      exact: true,
    });
    await expect(expiredActions.locator(".button")).toHaveCount(2);
    await expect(expiredDetails).toHaveAccessibleName(
      "View details for REQ-2026-1038",
    );
    await expect(expiredDetails).toHaveCSS("font-size", "14px");
    await expect(expiredDetails).toHaveCSS("font-weight", "600");
    await expect(expiredDetails).toHaveCSS("white-space", "nowrap");
    await expect(expiredActions).toHaveCSS("gap", "8px");
    await expect(page.locator("th.request-actions-cell")).toHaveCSS(
      "text-align",
      "right",
    );
    await expect(expiredRow.locator("td.request-actions-cell")).toHaveCSS(
      "text-align",
      "right",
    );
    await expect(expiredActions).toHaveCSS("justify-content", "flex-end");
    const detailsBox = await expiredDetails.boundingBox();
    const renewBox = await renew.boundingBox();
    expect(detailsBox?.height).toBe(renewBox?.height);
    expect(detailsBox?.height).toBe(width < 768 ? 44 : 36);
    if (width >= 360) {
      expect(detailsBox?.y).toBe(renewBox?.y);
    } else {
      expect(renewBox?.y ?? 0).toBeGreaterThan(detailsBox?.y ?? 0);
    }
    if (width < 768) {
      await page.locator(".table-scroll").evaluate((region) => {
        region.scrollLeft = region.scrollWidth;
      });
    }
    await page.screenshot({
      path: `test-results/request-actions-${width}.png`,
      fullPage: true,
    });
    await expiredDetails.focus();
    await page.keyboard.press("Enter");
    const expiredPanel = page.locator('[id="history-REQ-2026-1038"]');
    await expect(expiredPanel).toContainText("Access expired");
    await expect(expiredPanel).not.toContainText("Scheduled expiration");
    await renew.evaluate((link) =>
      link.addEventListener("click", (event) => event.preventDefault(), {
        once: true,
      }),
    );
    await renew.click();
    await expect(expiredPanel).toBeVisible();
    await expect(expiredDetails).toHaveAttribute("aria-expanded", "true");
    await expect(expiredDetails).toHaveAccessibleName(
      "Hide details for REQ-2026-1038",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await renew.click();
    await expect(page).toHaveURL(/requests\/new\?renew=REQ-2026-1038/);
    await expect(
      page.getByRole("heading", { name: "Renew resource access" }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => localStorage.getItem("permora-demo-v1")),
    ).toBe(initial);
    expect(errors).toEqual([]);
  });
}

test("original login imagery loads locally on desktop and mobile", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1024 });
    await page.goto("/login");
    await expect(page.locator(".login-blueprint img")).toHaveJSProperty(
      "complete",
      true,
    );
    await expect(page.locator(".login-blueprint img")).not.toHaveJSProperty(
      "naturalWidth",
      0,
    );
    if (width > 700) {
      await expect(page.locator(".login-visual")).toBeVisible();
      await expect(page.locator(".login-visual img")).not.toHaveJSProperty(
        "naturalWidth",
        0,
      );
    } else {
      await expect(page.locator(".login-visual")).toBeHidden();
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/stage1-login-${width}.png`,
      fullPage: true,
    });
  }
  expect(errors).toEqual([]);
});
