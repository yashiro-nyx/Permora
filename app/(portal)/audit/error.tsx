"use client";

import { Button } from "@/components/ui";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="alert tone-danger" role="alert">
      <div>
        <strong>Audit logs are temporarily unavailable</strong>
        <p>No audit records were changed. Try loading the page again.</p>
        <Button variant="outline" onClick={reset}>
          Try again
        </Button>
      </div>
    </div>
  );
}
