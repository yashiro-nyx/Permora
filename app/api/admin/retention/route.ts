import {
  handleRetentionList,
  handleRetentionPreview,
} from "@/lib/server/admin-governance-handlers";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export function GET(request: Request) {
  return handleRetentionList(request);
}

export function POST(request: Request) {
  return handleRetentionPreview(request);
}
