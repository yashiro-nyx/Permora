import { AppShell } from "@/components/app-shell";
import { ToastProvider } from "@/components/toast";
import {
  hasActiveApprovalResponsibility,
  requireIdentity,
} from "@/lib/server/identity";
import { allowsAdminFallback } from "@/lib/approval-routing-policy";

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
    <ToastProvider>
      <AppShell
        identity={identity}
        canReview={canReview}
        adminReviewEnabled={allowsAdminFallback()}
      >
        {children}
      </AppShell>
    </ToastProvider>
  );
}
