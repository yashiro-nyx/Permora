import { handleStaffNotificationReadRequest } from "@/lib/server/operations-handlers";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handleStaffNotificationReadRequest(request, (await context.params).id);
}
