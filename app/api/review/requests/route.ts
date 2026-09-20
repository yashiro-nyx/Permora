import { handleAssignedQueueRequest } from "@/lib/server/approval-read-handlers";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export function GET(request: Request) {
  return handleAssignedQueueRequest(request);
}
