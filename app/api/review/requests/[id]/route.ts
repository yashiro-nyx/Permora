import { handleAssignedDetailRequest } from "@/lib/server/approval-read-handlers";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handleAssignedDetailRequest(request, (await context.params).id);
}
