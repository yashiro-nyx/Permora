import Link from "next/link";
export default function NotFound() {
  return (
    <main className="standalone empty">
      <h1>We couldn’t find that page</h1>
      <p>Let’s get you back to your workspace.</p>
      <Link className="button button-primary" href="/dashboard">
        Go to dashboard
      </Link>
    </main>
  );
}
