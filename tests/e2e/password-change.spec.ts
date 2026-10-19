import { expect, test, type Page } from "@playwright/test";
import { E2E, e2eClientHeaders, signIn } from "./staff-fixture";

test.describe.configure({ mode: "serial" });

let user: Page;

test.beforeAll(async ({ browser }) => {
  user = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    extraHTTPHeaders: e2eClientHeaders(71),
  });
  // The otherApprover account exercises the user-owned change-password form;
  // the test never submits a change, so the shared fixture login stays valid.
  await signIn(user, E2E.otherApprover.email);
});

test.afterAll(async () => {
  await user.close();
});

test("change-password form guides strength and enforces client requirements", async () => {
  await user.goto("/account/password");
  await expect(user.getByRole("heading", { name: "Change password" })).toBeVisible();

  const submit = user.getByRole("button", { name: "Change password" });
  await expect(submit).toBeDisabled();

  // A weak, too-short password keeps submit disabled and shows weak strength.
  await user.locator("#current-password").fill("current-password-value");
  await user.locator("#new-password").fill("short");
  await expect(user.getByText(/Password strength:/)).toBeVisible();
  await expect(user.locator(".password-strength-label")).toContainText("Weak");
  await expect(submit).toBeDisabled();

  // A long, varied passphrase raises the indicator and (with confirmation) enables submit.
  const strong = "a-brand-new-unique-passphrase-2026";
  await user.locator("#new-password").fill(strong);
  await expect(user.locator(".password-strength-label")).toContainText(/Good|Strong/);
  // Requirement checklist reflects the min-length and difference rules as met.
  const requirements = user.locator(".password-requirements li.requirement-met");
  await expect(requirements).toHaveCount(3); // min, max, different; match still pending

  // Confirmation mismatch surfaces a field error and keeps submit disabled.
  await user.locator("#confirm-password").fill("does-not-match-this-value");
  await expect(user.getByText("The confirmation does not match the new password.")).toBeVisible();
  await expect(submit).toBeDisabled();

  // Matching confirmation satisfies all mandatory requirements and enables submit.
  await user.locator("#confirm-password").fill(strong);
  await expect(user.locator(".password-requirements li.requirement-met")).toHaveCount(4);
  await expect(submit).toBeEnabled();
});

test("new password reuse of the current password is blocked client-side", async () => {
  await user.goto("/account/password");
  const shared = "identical-password-value-123";
  await user.locator("#current-password").fill(shared);
  await user.locator("#new-password").fill(shared);
  await expect(
    user.getByText("Choose a password different from your current one."),
  ).toBeVisible();
  await expect(user.getByRole("button", { name: "Change password" })).toBeDisabled();
});

test("show/hide controls reveal and mask the password fields", async () => {
  await user.goto("/account/password");
  const newField = user.locator("#new-password");
  await newField.fill("a-brand-new-unique-passphrase-2026");
  await expect(newField).toHaveAttribute("type", "password");
  // The new-password reveal also controls the confirmation field.
  await user.getByRole("button", { name: "Show new and confirmation passwords" }).click();
  await expect(newField).toHaveAttribute("type", "text");
  await expect(user.locator("#confirm-password")).toHaveAttribute("type", "text");
  await user.getByRole("button", { name: "Hide new and confirmation passwords" }).click();
  await expect(newField).toHaveAttribute("type", "password");
});

for (const width of [390, 320]) {
  test(`change-password form fits ${width}px without document overflow`, async () => {
    await user.setViewportSize({ width, height: 900 });
    await user.goto("/account/password");
    expect(
      await user.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
  });
}
