const TRANSIENT_CONNECTION_CODES = new Set([
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
  "08001",
  "08003",
  "08006",
  "57P01",
  "57P02",
  "57P03",
]);

export function preferNeonPooler(connectionString: string) {
  const parsed = new URL(connectionString);
  const labels = parsed.hostname.split(".");
  if (
    parsed.hostname.endsWith(".neon.tech") &&
    labels[0] &&
    !labels[0].endsWith("-pooler")
  ) {
    labels[0] = `${labels[0]}-pooler`;
    parsed.hostname = labels.join(".");
  }
  return parsed.toString();
}

function errorValues(error: unknown): unknown[] {
  const pending = [error];
  const seen = new Set<object>();
  const values: unknown[] = [];
  while (pending.length) {
    const candidate = pending.pop();
    if (!candidate || typeof candidate !== "object" || seen.has(candidate))
      continue;
    seen.add(candidate);
    values.push(candidate);
    const value = candidate as { cause?: unknown; errors?: unknown };
    if (value.cause) pending.push(value.cause);
    if (Array.isArray(value.errors)) pending.push(...value.errors);
  }
  return values;
}

export function isTransientDatabaseConnectionError(error: unknown) {
  return errorValues(error).some((candidate) => {
    if (!candidate || typeof candidate !== "object") return false;
    const value = candidate as { code?: unknown; message?: unknown };
    if (
      typeof value.code === "string" &&
      TRANSIENT_CONNECTION_CODES.has(value.code)
    )
      return true;
    return (
      typeof value.message === "string" &&
      /^(?:Connection terminated unexpectedly|Connection terminated due to connection timeout|read ETIMEDOUT|timeout exceeded when trying to connect)$/i.test(
        value.message,
      )
    );
  });
}

export async function connectWithTransientRetry<T>(
  connect: () => Promise<T>,
  maximumAttempts: number,
) {
  let attempt = 0;
  while (attempt < maximumAttempts) {
    attempt += 1;
    try {
      return await connect();
    } catch (error) {
      if (
        attempt >= maximumAttempts ||
        !isTransientDatabaseConnectionError(error)
      )
        throw error;
    }
  }
  throw new Error("Database connection attempts were exhausted.");
}

export async function queryWithTransientReadRetry<T>(
  statement: string,
  execute: () => Promise<T>,
) {
  try {
    return await execute();
  } catch (error) {
    if (
      !/^SELECT\b/i.test(statement.trimStart()) ||
      !isTransientDatabaseConnectionError(error)
    )
      throw error;
    return execute();
  }
}
