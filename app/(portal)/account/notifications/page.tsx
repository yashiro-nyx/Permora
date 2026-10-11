import { NotificationPreferencesForm } from "@/components/notification-preferences-form";
import { getNotificationPreferences } from "@/lib/server/admin-governance-service";
import { requireIdentity } from "@/lib/server/identity";

export const metadata = { title: "Notification settings" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const identity = await requireIdentity();
  const preference = await getNotificationPreferences(identity.id);
  return <NotificationPreferencesForm preference={preference} />;
}
