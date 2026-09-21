export const HEALTH_CHECK_TIMEOUT_MS = 2_000;

export type HealthResult =
  | {
      status: 200;
      body: { status: "ok"; application: "available"; database: "available" };
    }
  | {
      status: 503;
      body: { status: "unavailable" };
    };

export async function resolveHealth(
  checkDatabase: () => Promise<unknown>,
  timeoutMs = HEALTH_CHECK_TIMEOUT_MS,
): Promise<HealthResult> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      checkDatabase(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Health check timed out.")),
          timeoutMs,
        );
      }),
    ]);
    return {
      status: 200,
      body: {
        status: "ok",
        application: "available",
        database: "available",
      },
    };
  } catch {
    return { status: 503, body: { status: "unavailable" } };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
