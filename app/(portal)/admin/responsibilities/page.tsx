import { AdminApproverResponsibilities } from "@/components/admin-approver-responsibilities";
import {
  listApproverOptions,
  listCatalogResources,
  listResponsibilities,
} from "@/lib/server/admin-governance-service";
import { requireAdmin } from "@/lib/server/identity";

export const metadata = { title: "Approver responsibilities" };
export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const values = await searchParams;
  const params = new URLSearchParams();
  const pageValue = Array.isArray(values.page) ? values.page[0] : values.page;
  if (pageValue) params.set("page", pageValue);
  const [data, approvers, resources] = await Promise.all([
    listResponsibilities(params),
    listApproverOptions(),
    listCatalogResources(),
  ]);
  return (
    <AdminApproverResponsibilities
      data={data}
      approvers={approvers}
      resources={resources}
    />
  );
}