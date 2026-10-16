import {
  handleUserDetailRequest,
  handleUserUpdateRequest,
} from "@/lib/server/account-handlers";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  return handleUserDetailRequest(request, (await context.params).id);
}

export async function PATCH(request: Request, context: RouteContext) {
  return handleUserUpdateRequest(request, (await context.params).id);
}
