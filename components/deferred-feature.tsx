import { Alert, PageHeading } from "./ui";

export function DeferredFeature({ title }: { title: string }) {
  return (
    <>
      <PageHeading
        eyebrow="DEFERRED"
        title={title}
        description="This protected area is reserved for a later implementation milestone."
      />
      <Alert title="No operation is available" tone="info">
        This page intentionally provides no management controls and does not
        imply that an unfinished server operation is available.
      </Alert>
    </>
  );
}
