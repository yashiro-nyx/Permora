import { handleScheduledExpiration } from "@/lib/server/maintenance-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export function POST(request: Request) {
  return handleScheduledExpiration(request);
}
