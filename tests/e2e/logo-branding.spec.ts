import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { E2E, e2eClientHeaders, signIn } from "./staff-fixture";

test.describe.configure({ mode: "serial" });

test("login page exposes the official logo and favicon", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator('img[alt="Permora logo"]')).toHaveCount(2);
  const iconLinks = page.locator('link[rel="icon"]');
  await expect(iconLinks).toHaveCount(1);
  const iconHref = await iconLinks.getAttribute("href");
  expect(iconHref).toMatch(/^\/icon\.png(?:\?.*)?$/);
  const iconResponse = await page.request.get(new URL(iconHref!, page.url()).toString());
  expect(iconResponse.status()).toBe(200);
  expect(iconResponse.headers()["content-type"]).toMatch(/^image\/png/);
  const servedIconHash = createHash("sha256").update(await iconResponse.body()).digest("hex");
  const sourceIconHash = createHash("sha256").update(readFileSync("app/icon.png")).digest("hex");
  expect(servedIconHash).toBe(sourceIconHash);
  for (const logo of await page.locator('img[alt="Permora logo"]').all()) {
    await expect(logo).toHaveAttribute("src", /Logo\.png/i);
  }
  await page.screenshot({ path: "test-results/logo-login.png", fullPage: true });
});

test("requester header and administrator sidebar use the official logo", async ({ browser }) => {
  const requester = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    extraHTTPHeaders: e2eClientHeaders(90),
  });
  const administrator = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    extraHTTPHeaders: e2eClientHeaders(91),
  });
  await signIn(requester, E2E.requester.email);
  await signIn(administrator, E2E.administrator.email);
  await requester.goto("/dashboard");
  await administrator.goto("/dashboard");
  await expect(requester.locator(".header-brand img[alt='Permora logo']")).toBeVisible();
  await expect(administrator.locator('aside img[alt="Permora logo"]')).toBeVisible();
  await requester.screenshot({ path: "test-results/logo-requester.png", fullPage: true });
  await administrator.screenshot({ path: "test-results/logo-administrator.png", fullPage: true });
  await requester.close();
  await administrator.close();
});

test("mobile navigation keeps the logo compact and visible", async ({ browser }) => {
  const page = await browser.newPage({
    viewport: { width: 390, height: 700 },
    extraHTTPHeaders: e2eClientHeaders(92),
  });
  await signIn(page, E2E.approver.email);
  await page.goto("/dashboard");
  await expect(page.locator("header img[alt='Permora logo']")).toBeVisible();
  await page.getByRole("button", { name: "Open navigation" }).click();
  const drawer = page.getByRole("dialog", { name: "Your workspace" });
  await expect(drawer.locator('img[alt="Permora logo"]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: "test-results/logo-mobile-drawer.png", fullPage: true });
  await page.close();
});
