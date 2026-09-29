import { InvitationAcceptanceForm } from "@/components/invitation-acceptance-form";
import { PageHeading } from "@/components/ui";

export const metadata = {
  title: "Set password",
  referrer: "no-referrer",
};
export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <main className="standalone-account-page">
      <PageHeading
        eyebrow="PERMORA / ACCOUNT"
        title="Set your password"
        description="Choose a password to finish setting up your account."
      />
      <section className="card invitation-acceptance-card" aria-label="Set account password">
        <InvitationAcceptanceForm />
      </section>
    </main>
  );
}
