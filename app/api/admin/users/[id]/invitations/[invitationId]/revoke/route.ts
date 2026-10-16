import { handleInvitationRevokeRequest } from "@/lib/server/invitation-handlers";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; invitationId: string }> },
) {
  const params = await context.params;
  return handleInvitationRevokeRequest(request, params.id, params.invitationId);
}
