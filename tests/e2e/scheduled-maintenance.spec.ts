import { expect, test } from "@playwright/test";

// The scheduled maintenance endpoint must be disabled by default: with no
// MAINTENANCE_SCHEDULER_SECRET configured (as in the test web server), it must
// never run and must not be reachable without a credential.
test("scheduled expiration endpoint is disabled without a configured secret", async ({
  request,
}) => {
  const response = await request.post("/api/maintenance/expire-activations", {
    headers: { authorization: "Bearer anything" },
  });
  expect(response.status()).toBe(503);
  const body = (await response.json()) as { error?: { code?: string } };
  expect(body.error?.code).toBe("scheduler_disabled");
});

test("scheduled expiration endpoint rejects GET", async ({ request }) => {
  const response = await request.get("/api/maintenance/expire-activations");
  // No GET handler is exported; Next responds 405 Method Not Allowed.
  expect(response.status()).toBe(405);
});
