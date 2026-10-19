import { AdminActivationQueue } from "@/components/admin-activation-queue";
import { listAdministratorActivations } from "@/lib/server/activation-read-service";
import { query } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/identity";

export const metadata = { title: "Activations" };
export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ requestId?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const focusRequestId =
    params.requestId && /^[0-9a-f-]{36}$/i.test(params.requestId)
      ? params.requestId
      : undefined;
  const items = await listAdministratorActivations();
  let focusedRequestState = null;
  if (focusRequestId && !items.some((item) => item.requestId === focusRequestId)) {
    const result = await query<{
      display_id: string;
      status: string;
      activation_status: "activating" | "activated" | "failed" | "expired" | "revoked" | null;
    }>(
      `SELECT request.display_id, request.status,
              activation.status AS activation_status
         FROM access_request request
         LEFT JOIN request_activation activation
           ON activation.request_id = request.id
        WHERE request.id = $1`,
      [focusRequestId],
    );
    const row = result.rows[0];
    focusedRequestState = row
      ? {
          displayId: row.display_id,
          requestStatus: row.status,
          activationStatus: row.activation_status,
        }
      : null;
  }
  return (
    <AdminActivationQueue
      items={items}
      focusRequestId={focusRequestId}
      focusedRequestState={focusedRequestState}
    />
  );
}
