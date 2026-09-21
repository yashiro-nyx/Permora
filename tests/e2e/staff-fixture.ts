export const E2E = {
  password: "Permora browser test password 2026!",
  approver: {
    id: "e2000000-0000-4000-8000-000000000001",
    email: "approver.e2e@permora.test",
  },
  otherApprover: {
    id: "e2000000-0000-4000-8000-000000000002",
    email: "other-approver.e2e@permora.test",
  },
  administrator: {
    id: "e2000000-0000-4000-8000-000000000003",
    email: "administrator.e2e@permora.test",
  },
  requester: {
    id: "e2000000-0000-4000-8000-000000000004",
    email: "requester.e2e@permora.test",
  },
  workflowRequester: {
    id: "e2000000-0000-4000-8000-000000000005",
    email: "workflow-requester.e2e@permora.test",
  },
  requests: {
    approve: "e2000000-0000-4000-8000-000000000101",
    retry: "e2000000-0000-4000-8000-000000000102",
    stale: "e2000000-0000-4000-8000-000000000103",
    anotherApprover: "e2000000-0000-4000-8000-000000000104",
    unassigned: "e2000000-0000-4000-8000-000000000105",
  },
} as const;
