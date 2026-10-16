import { AdminActivationQueue } from "@/components/admin-activation-queue";
import { listAdministratorActivations } from "@/lib/server/activation-read-service";
import { requireAdmin } from "@/lib/server/identity";

export const metadata = { title: "Activations" };
export const dynamic = "force-dynamic";

export default async function Page() {
  await requireAdmin();
  const items = await listAdministratorActivations();
  return <AdminActivationQueue items={items} />;
}
