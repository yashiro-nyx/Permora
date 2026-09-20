import { ServerRequestsList } from "@/components/server-requests-list";
import { requireRequester } from "@/lib/server/identity";
import {
  getOwnedRequestCounts,
  listOwnedRequestResources,
  listOwnedRequests,
} from "@/lib/server/request-service";

export const metadata = { title: "Access requests" };
export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{
    query?: string;
    status?: string;
    resource?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const params = await searchParams;
  const identity = await requireRequester();
  const [rows, counts, resources] = await Promise.all([
    listOwnedRequests(identity.id, params),
    getOwnedRequestCounts(identity.id),
    listOwnedRequestResources(identity.id),
  ]);
  return (
    <ServerRequestsList
      rows={rows}
      counts={counts}
      filters={params}
      resources={resources}
    />
  );
}
