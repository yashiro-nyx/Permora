import { AccountEditor } from "@/components/account-management";
import { requireAdmin } from "@/lib/server/identity";

export const metadata = { title: "Create user" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const identity = await requireAdmin();
  return <AccountEditor mode="create" actorId={identity.id} />;
}
