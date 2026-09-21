import { notFound } from "next/navigation";
import { StaffReviewDetail } from "@/components/staff-review-detail";
import { getAssignedReviewRequest } from "@/lib/server/approval-read-service";
import { requireApprover } from "@/lib/server/identity";

export const metadata = { title: "Review access request" };
export const dynamic = "force-dynamic";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const identity = await requireApprover();
  const request = await getAssignedReviewRequest(identity, (await params).id);
  if (!request) notFound();
  return <StaffReviewDetail request={request} />;
}
