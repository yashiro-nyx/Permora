import { handleAuditListRequest } from "@/lib/server/operations-handlers";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export function GET(request: Request) {
  return handleAuditListRequest(request);
}
