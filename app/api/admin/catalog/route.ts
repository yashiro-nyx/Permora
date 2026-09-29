import { handleCatalogGet, handleCatalogToggle } from "@/lib/server/admin-governance-handlers";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export function GET(request: Request) {
  return handleCatalogGet(request);
}

export function PATCH(request: Request) {
  return handleCatalogToggle(request);
}
