import { PasswordChangeForm } from "@/components/password-change-form";
import { requireIdentity } from "@/lib/server/identity";

export const metadata = { title: "Change password" };
export const dynamic = "force-dynamic";

export default async function Page() {
  await requireIdentity();
  return <PasswordChangeForm />;
}
