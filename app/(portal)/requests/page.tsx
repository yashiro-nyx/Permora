import { ServerRequestsList } from "@/components/server-requests-list";
import { parsePageParams } from "@/lib/pagination";
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
    page?: string;
    pageSize?: string;
  }>;
}) {
  const params = await searchParams;
  const identity = await requireRequester();
  const pageParams = parsePageParams(
    new URLSearchParams(
      Object.entries(params).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
  );
  const [list, counts, resources] = await Promise.all([
    listOwnedRequests(identity.id, { ...params, ...pageParams }),
    getOwnedRequestCounts(identity.id),
    listOwnedRequestResources(identity.id),
  ]);
  return (
    <ServerRequestsList
      rows={list.items}
      counts={counts}
      filters={params}
      resources={resources}
      pagination={list.pagination}
    />
  );
}
