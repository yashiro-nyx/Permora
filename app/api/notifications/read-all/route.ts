import { handleAllNotificationsReadRequest } from "@/lib/server/operations-handlers";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export function POST(request: Request) {
  return handleAllNotificationsReadRequest(request);
}
