// Maintenance flag semantics, shared by the Edge middleware and the Node layer.
// Intentionally dependency-free and NOT server-only so the Edge middleware can
// import it (middleware runs on the Edge runtime and must not pull in `pg` or
// any server-only module).

export type MaintenanceState = "on" | "off" | "invalid";

/** Parse PERMORA_MAINTENANCE into an explicit state. */
export function maintenanceMode(
  raw: string | undefined = process.env.PERMORA_MAINTENANCE,
): MaintenanceState {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "") return "off";
  if (["1", "true", "on", "yes"].includes(value)) return "on";
  if (["0", "false", "off", "no"].includes(value)) return "off";
  return "invalid";
}

/**
 * Whether maintenance is active. Fail-closed: a malformed value blocks (treated
 * as "on"). We do not throw here so the Edge middleware stays simple; the Node
 * layer can surface the invalid state separately if desired.
 */
export function maintenanceActive(
  state: MaintenanceState = maintenanceMode(),
): boolean {
  return state === "on" || state === "invalid";
}
