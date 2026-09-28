import { RequesterNotifications } from "@/components/requester-notifications";
import { requireRequester } from "@/lib/server/identity";
import {
  listRequesterNotifications,
  OperationsQueryError,
  parseNotificationFilters,
} from "@/lib/server/operations-service";

export const metadata = { title: "Notifications" };
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
  const identity = await requireRequester();
  try {
    const filters = parseNotificationFilters(paramsOf(await searchParams));
    const data = await listRequesterNotifications(identity.id, filters);
    return <RequesterNotifications data={data} filters={filters} />;
  } catch (error) {
    if (error instanceof OperationsQueryError) {
      const filters = parseNotificationFilters(new URLSearchParams());
      const data = await listRequesterNotifications(identity.id, filters);
      return (
        <RequesterNotifications
          data={data}
          filters={filters}
          invalidMessage={error.message}
        />
      );
    }
    throw error;
  }
}
