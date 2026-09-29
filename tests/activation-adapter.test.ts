import assert from "node:assert/strict";
import test from "node:test";
import {
  ActivationAdapter,
  ActivationAdapterContext,
  ActivationAdapterResult,
  invokeActivationAdapter,
  ManualActivationContext,
  ManualAdminActivationAdapter,
} from "../lib/activation-adapter";

const adapterContext: ActivationAdapterContext = {
  activationId: "10000000-0000-4000-8000-000000000001",
  requestId: "20000000-0000-4000-8000-000000000002",
  actorUserId: "30000000-0000-4000-8000-000000000003",
  resourceId: "r-library",
  permissionId: "library:subscribed-materials",
  scopeFingerprint: "resource-wide",
  startsAt: "2026-10-01T00:00:00.000Z",
  expiresAt: "2026-11-01T00:00:00.000Z",
};

const manualContext = (
  confirmation: ManualActivationContext["operatorConfirmation"],
): ManualActivationContext => ({
  ...adapterContext,
  operatorConfirmation: confirmation,
});

test("adapter contract accepts an implementation and forwards context", async () => {
  let receivedContext: ActivationAdapterContext | undefined;
  const expected: ActivationAdapterResult = {
    outcome: "success",
    externalReference: "ticket-123",
    evidence: null,
  };
  const adapter: ActivationAdapter = {
    name: "contract-test",
    async activate(context) {
      receivedContext = context;
      return expected;
    },
  };

  const result = await invokeActivationAdapter(adapter, adapterContext);

  assert.equal(adapter.name, "contract-test");
  assert.equal(receivedContext, adapterContext);
  assert.deepEqual(result, expected);
});

test("manual adapter maps explicit provisioning and external reference to success", async () => {
  const adapter = new ManualAdminActivationAdapter();
  const result = await invokeActivationAdapter(
    adapter,
    manualContext({
      provisioned: true,
      externalReference: "  ITSM-REQ-4182  ",
    }),
  );

  assert.equal(adapter.name, "manual-admin");
  assert.deepEqual(result, {
    outcome: "success",
    externalReference: "ITSM-REQ-4182",
    evidence: null,
  });
});

test("manual adapter accepts human-readable evidence without an external reference", async () => {
  const result = await new ManualAdminActivationAdapter().activate(
    manualContext({
      provisioned: true,
      evidence: "Library administrator confirmed the account is enabled.",
    }),
  );

  assert.deepEqual(result, {
    outcome: "success",
    externalReference: null,
    evidence: "Library administrator confirmed the account is enabled.",
  });
});

test("manual adapter maps unconfirmed provisioning to a retryable failure", async () => {
  const result = await new ManualAdminActivationAdapter().activate(
    manualContext({ provisioned: false }),
  );

  assert.deepEqual(result, {
    outcome: "failure",
    failureCode: "manual_provisioning_not_confirmed",
    message: "The administrator did not confirm that access was provisioned.",
    retryable: true,
  });
});

test("manual adapter refuses success without a reference or evidence", async () => {
  const result = await new ManualAdminActivationAdapter().activate(
    manualContext({ provisioned: true, externalReference: "  ", evidence: " " }),
  );

  assert.deepEqual(result, {
    outcome: "failure",
    failureCode: "manual_confirmation_evidence_required",
    message:
      "Provide an external reference or human-readable evidence for the provisioning confirmation.",
    retryable: true,
  });
});
