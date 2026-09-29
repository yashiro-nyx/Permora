import { handleEligibleAssignees, handleManualAssign } from "@/lib/server/admin-governance-handlers";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return context.params.then((params) => handleEligibleAssignees(request, params.id));
}

export function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return context.params.then((params) => handleManualAssign(request, params.id));
}
