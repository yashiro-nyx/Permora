import { AdminReports } from "@/components/admin-reports";
import { GovernanceError } from "@/lib/admin-governance";
import {
  getAnalyticsSummary,
  listCatalogResources,
} from "@/lib/server/admin-governance-service";
import { requireAdmin } from "@/lib/server/identity";

export const metadata = { title: "Reports & analytics" };
export const dynamic = "force-dynamic";

function firstValue(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const values = await searchParams;
  const requested = {
    from: firstValue(values.from).trim(),
    to: firstValue(values.to).trim(),
    resource: firstValue(values.resource).trim(),
    status: firstValue(values.status).trim(),
  };

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(requested)) {
    if (value) params.set(key, value);
  }

  let filterError: string | undefined;
  let summary;
  try {
    summary = await getAnalyticsSummary(params);
  } catch (error) {
    // Fall back to an unfiltered summary if the submitted filters are invalid,
    // so the dashboard stays usable rather than erroring out entirely.
    if (!(error instanceof GovernanceError)) throw error;
    filterError = "The submitted filters were invalid.";
    summary = await getAnalyticsSummary(new URLSearchParams());
  }

  const resources = (await listCatalogResources()).map((resource) => ({
    id: resource.id,
    name: resource.name,
  }));

  return (
    <AdminReports
      summary={summary}
      resources={resources}
      filters={requested}
      filterError={filterError}
    />
  );
}
