import { maintenanceActive, maintenanceMode } from "@/lib/maintenance";

// Database-free maintenance status probe. The ONLY path allowlisted by the
// maintenance middleware. It performs NO database access and cannot mutate
// anything — it only reports the maintenance flag state.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export function GET() {
  const active = maintenanceActive(maintenanceMode());
  return Response.json(
    {
      status: active ? "maintenance" : "available",
      database: "not-checked",
    },
    {
      status: active ? 503 : 200,
      headers: { "cache-control": "no-store" },
    },
  );
}
