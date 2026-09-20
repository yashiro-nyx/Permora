import { ServerDashboard } from "@/components/server-dashboard";
import { requireIdentity } from "@/lib/server/identity";
import {
  getOwnedRequestCounts,
  listOwnedRequests,
} from "@/lib/server/request-service";

export const metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const identity = await requireIdentity();
  if (!identity.requesterRole) return <ServerDashboard identity={identity} />;
  const [counts, recent] = await Promise.all([
    getOwnedRequestCounts(identity.id),
    listOwnedRequests(identity.id),
  ]);
  return (
    <ServerDashboard
      identity={identity}
      counts={counts}
      recent={recent.slice(0, 4)}
    />
  );
}
