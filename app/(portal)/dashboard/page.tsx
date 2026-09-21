import { ServerDashboard } from "@/components/server-dashboard";
import { StaffDashboard } from "@/components/staff-dashboard";
import {
  hasActiveApprovalResponsibility,
  requireIdentity,
} from "@/lib/server/identity";
import {
  getOwnedRequestCounts,
  listOwnedRequests,
} from "@/lib/server/request-service";
import {
  listAssignedReviewRequests,
  listUnassignedRoutingFailures,
} from "@/lib/server/approval-read-service";

export const metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const identity = await requireIdentity();
  if (!identity.requesterRole) {
    try {
      const canReview = await hasActiveApprovalResponsibility(identity.id);
      const filters = { page: 1, pageSize: 5 };
      const [pending, approved, denied, returned, unassigned] =
        await Promise.all([
          canReview
            ? listAssignedReviewRequests(identity, {
                ...filters,
                status: "pending_review",
              })
            : null,
          canReview
            ? listAssignedReviewRequests(identity, {
                ...filters,
                status: "approved_pending_activation",
              })
            : null,
          canReview
            ? listAssignedReviewRequests(identity, {
                ...filters,
                status: "denied",
              })
            : null,
          canReview
            ? listAssignedReviewRequests(identity, {
                ...filters,
                status: "returned_for_revision",
              })
            : null,
          identity.roles.includes("admin")
            ? listUnassignedRoutingFailures(filters)
            : null,
        ]);
      return (
        <StaffDashboard
          identity={identity}
          canReview={canReview}
          data={{
            pending: pending?.pagination.total ?? 0,
            approvedPendingActivation: approved?.pagination.total ?? 0,
            denied: denied?.pagination.total ?? 0,
            returnedForRevision: returned?.pagination.total ?? 0,
            unassigned: unassigned?.pagination.total,
            recent: pending?.items ?? [],
          }}
        />
      );
    } catch {
      return (
        <StaffDashboard
          identity={identity}
          canReview={false}
          unavailable
        />
      );
    }
  }
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
