import { handleUserDeactivationRequest } from "@/lib/server/account-handlers";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handleUserDeactivationRequest(request, (await context.params).id);
}
