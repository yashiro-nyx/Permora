import { DeferredFeature } from "@/components/deferred-feature";
import { requireAdmin } from "@/lib/server/identity";
export const metadata = { title: "Reports & analytics" };
export default async function Page() {
  await requireAdmin();
  return <DeferredFeature title="Reports & analytics" />;
}
