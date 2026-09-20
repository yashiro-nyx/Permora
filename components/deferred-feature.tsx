import { Alert, PageHeading } from "./ui";

export function DeferredFeature({ title }: { title: string }) {
  return (
    <>
      <PageHeading
        eyebrow="STAGE 2A"
        title={title}
        description="This authenticated area is reserved for a later implementation stage."
      />
      <Alert title="No operation is available" tone="info">
        Approval decisions, access activation, notifications, and administrative
        management are deferred. This page does not read or mutate demo data.
      </Alert>
    </>
  );
}
