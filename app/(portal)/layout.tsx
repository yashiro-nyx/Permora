import { AppShell } from "@/components/app-shell";
import {
  hasActiveApprovalResponsibility,
  requireIdentity,
} from "@/lib/server/identity";

export const dynamic = "force-dynamic";
export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const identity = await requireIdentity();
  let canReview = false;
  if (
    identity.roles.includes("approver") ||
    identity.roles.includes("admin")
  ) {
    try {
      canReview = await hasActiveApprovalResponsibility(identity.id);
    } catch (error) {
      console.error(
        "Unable to determine review navigation visibility.",
        error,
      );
    }
  }
  return (
    <AppShell identity={identity} canReview={canReview}>
      {children}
    </AppShell>
  );
}
