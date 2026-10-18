import { StaffNotifications } from "@/components/staff-notifications";
import { requireStaff } from "@/lib/server/identity";
import {
  listStaffNotifications,
  OperationsQueryError,
  parseNotificationFilters,
} from "@/lib/server/operations-service";

export const metadata = { title: "Staff Notifications" };
export const dynamic = "force-dynamic";

function paramsOf(values: Record<string, string | string[] | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first !== undefined) params.set(key, first);
  }
  return params;
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const identity = await requireStaff();
  try {
    const filters = parseNotificationFilters(paramsOf(await searchParams));
    const data = await listStaffNotifications(identity.id, filters);
    return <StaffNotifications data={data} filters={filters} />;
  } catch (error) {
    if (error instanceof OperationsQueryError) {
      const filters = parseNotificationFilters(new URLSearchParams());
      const data = await listStaffNotifications(identity.id, filters);
      return (
        <StaffNotifications
          data={data}
          filters={filters}
          invalidMessage={error.message}
        />
      );
    }
    throw error;
  }
}
