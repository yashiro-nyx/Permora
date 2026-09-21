import { DeferredFeature } from "@/components/deferred-feature";
import { requireAdmin } from "@/lib/server/identity";
export const metadata = { title: "User management" };
export default async function Page() {
  await requireAdmin();
  return <DeferredFeature title="User management" />;
}
