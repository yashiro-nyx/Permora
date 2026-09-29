import { notFound } from "next/navigation";
import { AccountEditor } from "@/components/account-management";
import { AccountServiceError } from "@/lib/account-management";
import { getUser } from "@/lib/server/account-service";
import { requireAdmin } from "@/lib/server/identity";

export const metadata = { title: "Edit user" };
export const dynamic = "force-dynamic";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const identity = await requireAdmin();
  let user;
  try {
    user = await getUser((await params).id);
  } catch (error) {
    if (error instanceof AccountServiceError && error.code === "invalid_input")
      notFound();
    throw error;
  }
  if (!user) notFound();
  return <AccountEditor mode="edit" user={user} actorId={identity.id} />;
}
