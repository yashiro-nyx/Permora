import {
  handleIdentifierList,
  handleIdentifierUpsert,
} from "@/lib/server/admin-governance-handlers";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return context.params.then((params) => handleIdentifierList(request, params.id));
}

export function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return context.params.then((params) => handleIdentifierUpsert(request, params.id));
}
