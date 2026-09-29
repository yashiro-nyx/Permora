import { handleAnalytics } from "@/lib/server/admin-governance-handlers";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export function GET(request: Request) {
  return handleAnalytics(request);
}
