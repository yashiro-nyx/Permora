import { AdminDelegations } from "@/components/admin-delegations";
import {
  listApproverOptions,
  listDelegations,
} from "@/lib/server/admin-governance-service";
import { requireAdmin } from "@/lib/server/identity";

export const metadata = { title: "Delegation & absence management" };
export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const key of ["page", "pageSize"]) {
    const value = params[key];
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first === "string") query.set(key, first);
  }
  const [delegations, approvers] = await Promise.all([
    listDelegations(query),
    listApproverOptions(),
  ]);
  return (
    <AdminDelegations
      delegations={delegations.items}
      approvers={approvers}
      pagination={delegations.pagination}
    />
  );
}
