import { handleInvitationAcceptanceRequest } from "@/lib/server/invitation-handlers";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export function POST(request: Request) {
  return handleInvitationAcceptanceRequest(request);
}
