import { handlePasswordChangeRequest } from "@/lib/server/credential-handlers";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export function POST(request: Request) {
  return handlePasswordChangeRequest(request);
}
