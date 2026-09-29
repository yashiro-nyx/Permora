import { handleUserReactivationRequest } from "@/lib/server/account-handlers";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handleUserReactivationRequest(request, (await context.params).id);
}
