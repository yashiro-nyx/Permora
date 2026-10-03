import { AdminUnassignedAssignments } from "@/components/admin-unassigned-assignments";
import {
  ApprovalQueryError,
  listUnassignedRoutingFailures,
  parseApprovalListFilters,
} from "@/lib/server/approval-read-service";
import { requireAdmin } from "@/lib/server/identity";

export const metadata = { title: "Unassigned requests" };
export const dynamic = "force-dynamic";

function paramsOf(values: Record<string, string | string[] | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first !== undefined) params.set(key, first);
  }
  return params;
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  try {
    const filters = parseApprovalListFilters(
      paramsOf(await searchParams),
      "unassigned",
    );
    const data = await listUnassignedRoutingFailures(filters);
    return <AdminUnassignedAssignments data={data} filters={filters} />;
  } catch (error) {
    if (error instanceof ApprovalQueryError) {
      const filters = parseApprovalListFilters(
        new URLSearchParams(),
        "unassigned",
      );
      const data = await listUnassignedRoutingFailures(filters);
      return (
        <AdminUnassignedAssignments
          data={data}
          filters={filters}
          invalidMessage={error.message}
        />
      );
    }
    throw error;
  }
}
