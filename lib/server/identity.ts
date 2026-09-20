import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { TrustedIdentity } from "@/lib/auth-types";
import {
  getTrustedIdentityFromHeaders,
  hasActiveApprovalResponsibility,
} from "./identity-data";
export type { TrustedIdentity } from "@/lib/auth-types";
export { getTrustedIdentityFromHeaders, hasActiveApprovalResponsibility };

export async function getTrustedIdentity(): Promise<TrustedIdentity | null> {
  return getTrustedIdentityFromHeaders(await headers());
}

export async function requireIdentity() {
  const identity = await getTrustedIdentity();
  if (!identity) redirect("/login");
  return identity;
}

export async function requireRequester() {
  const identity = await requireIdentity();
  if (!identity.requesterRole) redirect("/dashboard?unavailable=requester");
  return identity as TrustedIdentity & {
    requesterRole: "student" | "faculty";
  };
}

export async function requireAdmin() {
  const identity = await requireIdentity();
  if (!identity.roles.includes("admin"))
    redirect("/dashboard?unavailable=administrator");
  return identity;
}

export async function requireApprover() {
  const identity = await requireIdentity();
  if (
    (!identity.roles.includes("approver") &&
      !identity.roles.includes("admin")) ||
    !(await hasActiveApprovalResponsibility(identity.id))
  )
    redirect("/dashboard?unavailable=approver");
  return identity;
}
