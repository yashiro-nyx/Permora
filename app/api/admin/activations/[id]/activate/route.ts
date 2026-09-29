import { handleActivationStartRequest } from "@/lib/server/activation-handlers";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handleActivationStartRequest(request, (await context.params).id);
}
