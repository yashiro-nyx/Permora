import { db } from "@/lib/server/db";
import { resolveHealth } from "@/lib/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
};

export async function GET() {
  const result = await resolveHealth(() =>
    db.query("SELECT 1"),
  );
  return Response.json(result.body, { status: result.status, headers });
}
