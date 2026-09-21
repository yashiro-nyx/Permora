import { DeferredFeature } from "@/components/deferred-feature";
import { requireAdmin } from "@/lib/server/identity";
export const metadata = { title: "Audit history" };
export default async function Page() {
  await requireAdmin();
  return <DeferredFeature title="Audit history" />;
}
