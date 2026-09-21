import { expect, test } from "@playwright/test";

test("health endpoint reports bounded database availability without disclosure", async ({
  request,
}) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("private");
  expect(response.headers()["cache-control"]).toContain("no-store");
  const body = await response.json();
  expect(body).toEqual({
    status: "ok",
    application: "available",
    database: "available",
  });
  expect(JSON.stringify(body)).not.toMatch(
    /postgres|database_url|hostname|version|account|password|secret|token/i,
  );
});
