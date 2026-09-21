"use client";

import { Alert, Button, PageHeading } from "@/components/ui";

export default function ReviewError({ reset }: { reset: () => void }) {
  return (
    <>
      <PageHeading
        eyebrow="STAFF › REVIEW QUEUE"
        title="Review requests"
        description="Protected approval data could not be loaded."
      />
      <Alert title="Review service is temporarily unavailable" tone="danger">
        No request information was substituted or exposed. Try the protected
        query again.
      </Alert>
      <div className="heading-action">
        <Button onClick={reset}>Try again</Button>
      </div>
    </>
  );
}
