import {
  handleUserCreateRequest,
  handleUserListRequest,
} from "@/lib/server/account-handlers";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export function GET(request: Request) {
  return handleUserListRequest(request);
}

export function POST(request: Request) {
  return handleUserCreateRequest(request);
}
