import {
  handleDelegationCreate,
  handleDelegationList,
} from "@/lib/server/admin-governance-handlers";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export function GET(request: Request) {
  return handleDelegationList(request);
}

export function POST(request: Request) {
  return handleDelegationCreate(request);
}
