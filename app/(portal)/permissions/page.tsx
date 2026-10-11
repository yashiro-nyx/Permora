import { AdminPermissionCatalog } from "@/components/admin-permission-catalog";
import { listCatalogResources } from "@/lib/server/admin-governance-service";
import { requireAdmin } from "@/lib/server/identity";

export const metadata = { title: "Permissions & eligibility" };
export const dynamic = "force-dynamic";

export default async function Page() {
  await requireAdmin();
  const resources = await listCatalogResources();
  return <AdminPermissionCatalog resources={resources} />;
}
