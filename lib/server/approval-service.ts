import "server-only";
import { applyApprovalDecision, type ApprovalDecision } from "../approval-domain";
import { transaction } from "./db";

export function decideAssignedRequest(
  actorUserId: string,
  input: {
    requestId: string;
    expectedVersion: number;
    decision: ApprovalDecision;
    reason?: string;
    idempotencyKey: string;
  },
) {
  return transaction((client) =>
    applyApprovalDecision(client, actorUserId, input),
  );
}
