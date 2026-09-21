import Link from "next/link";
import { Alert, PageHeading } from "@/components/ui";

export const metadata = { title: "Help & guidelines" };

export default function Page() {
  return (
    <>
      <PageHeading
        eyebrow="ACCESS MADE CLEAR"
        title="Help & access guidelines"
        description="How the authenticated Stage 2A requester workflow behaves."
      />
      <div className="help-grid">
        <section className="card card-body prose">
          <h2>Accounts and sign-in</h2>
          <p>
            Accounts and roles are provisioned by an authorized administrator.
            Public registration and automated password recovery are unavailable.
          </p>
          <p>
            Your session is stored server-side and can be revoked. Signing out
            invalidates the current session.
          </p>
        </section>
        <section className="card card-body prose">
          <h2>Request only additional access</h2>
          <p>
            Ordinary access supplied through enrollment or employment should not
            be requested again. Permora blocks a matching entitlement recorded
            by an administrator.
          </p>
          <p>
            Available sections, laboratories, software, and projects come from
            trusted assignment records. You cannot type or assign a more
            privileged scope.
          </p>
        </section>
        <section className="card card-body prose">
          <h2>Pending requests</h2>
          <p>
            A successful submission creates a pending database record and
            immutable submission history. It does not create an approval or
            active grant.
          </p>
          <p>
            Renewals create new pending requests and are checked against current
            policy, assignments, conflicts, and approval routing.
          </p>
        </section>
        <section className="card card-body prose">
          <h2>Stage boundary</h2>
          <p>
            Assigned staff can now record approval, denial, or revision
            decisions. Approval remains separate from downstream activation.
            Provisioning, expiration enforcement, external notifications, and
            full administrator management remain deferred.
          </p>
          <Link className="text-link" href="/dashboard">
            Return to dashboard →
          </Link>
        </section>
      </div>
      <Alert title="Need account help?" tone="warning">
        Contact an authorized Permora administrator. The sign-in screen does not
        reveal whether an email address exists.
      </Alert>
    </>
  );
}
