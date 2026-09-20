import { notFound } from "next/navigation";
import { ServerRequestDetails } from "@/components/server-request-details";
import { requireRequester } from "@/lib/server/identity";
import { getOwnedRequest } from "@/lib/server/request-service";

export const metadata = { title: "Request details" };
export const dynamic = "force-dynamic";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ submitted?: string }>;
}) {
  const { id } = await params;
  const identity = await requireRequester();
  const request = await getOwnedRequest(identity.id, id);
  if (!request) notFound();
  return (
    <ServerRequestDetails
      request={request}
      identity={identity}
      submitted={(await searchParams).submitted === "1"}
    />
  );
}
