import { handleApprovalDecisionRequest } from "@/lib/server/approval-decision-handlers";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handleApprovalDecisionRequest(request, (await context.params).id);
}
