import { AdministratorAuditLog } from "@/components/administrator-audit-log";
import { requireAdmin } from "@/lib/server/identity";
import {
  listAdministratorAuditEvents,
  OperationsQueryError,
  parseAuditFilters,
} from "@/lib/server/operations-service";

export const metadata = { title: "Audit history" };
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
    const filters = parseAuditFilters(paramsOf(await searchParams));
    const data = await listAdministratorAuditEvents(filters);
    return <AdministratorAuditLog data={data} filters={filters} />;
  } catch (error) {
    if (error instanceof OperationsQueryError) {
      const filters = parseAuditFilters(new URLSearchParams());
      const data = await listAdministratorAuditEvents(filters);
      return (
        <AdministratorAuditLog
          data={data}
          filters={filters}
          invalidMessage={error.message}
        />
      );
    }
    throw error;
  }
}
