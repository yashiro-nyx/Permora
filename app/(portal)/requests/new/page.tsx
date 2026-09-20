import { ServerRequestForm } from "@/components/server-request-form";
import { requireRequester } from "@/lib/server/identity";
import {
  getOwnedRequest,
  getRequestableResources,
} from "@/lib/server/request-service";

export const metadata = { title: "Request access" };
export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ resource?: string; renew?: string }>;
}) {
  const params = await searchParams;
  const identity = await requireRequester();
  const [resources, renewal] = await Promise.all([
    getRequestableResources(identity),
    params.renew
      ? getOwnedRequest(identity.id, params.renew)
      : Promise.resolve(null),
  ]);
  return (
    <ServerRequestForm
      identity={identity}
      resources={resources}
      initialResource={params.resource}
      renewal={renewal}
    />
  );
}
