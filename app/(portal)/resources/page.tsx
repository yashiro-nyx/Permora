import { AdminResourceCatalog } from "@/components/admin-resource-catalog";
import { listCatalogResources } from "@/lib/server/admin-governance-service";
import { requireAdmin } from "@/lib/server/identity";

export const metadata = { title: "Resource catalog" };
export const dynamic = "force-dynamic";

export default async function Page() {
  await requireAdmin();
  const resources = await listCatalogResources();
  return <AdminResourceCatalog resources={resources} />;
}
