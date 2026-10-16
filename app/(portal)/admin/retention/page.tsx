import { AdminRetention } from "@/components/admin-retention";
import { listRetentionPolicies } from "@/lib/server/admin-governance-service";
import { requireAdmin } from "@/lib/server/identity";

export const metadata = { title: "Retention management" };
export const dynamic = "force-dynamic";

export default async function Page() {
  await requireAdmin();
  const policies = await listRetentionPolicies();
  return <AdminRetention policies={policies} />;
}
