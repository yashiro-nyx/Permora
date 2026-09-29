import { handleInvitationIssueRequest } from "@/lib/server/invitation-handlers";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handleInvitationIssueRequest(request, (await context.params).id);
}
