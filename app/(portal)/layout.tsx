import { AppShell } from "@/components/app-shell";
import { requireIdentity } from "@/lib/server/identity";

export const dynamic = "force-dynamic";
export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const identity = await requireIdentity();
  return <AppShell identity={identity}>{children}</AppShell>;
}
