const ALLOWED_FIELDS = new Set([
  "resourceId",
  "permissionId",
  "purpose",
  "startsAt",
  "expiresAt",
  "renewalOf",
]);

export function extractRequestInput(
  entries: Iterable<[string, FormDataEntryValue]>,
) {
  const input: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (typeof value !== "string") continue;
    if (ALLOWED_FIELDS.has(key) || key.startsWith("scope:")) input[key] = value;
  }
  return input;
}
