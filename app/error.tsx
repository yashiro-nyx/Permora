"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="standalone empty">
      <h1>Permora is temporarily unavailable</h1>
      <p>
        The server could not complete this request. No local fallback was used
        and no success should be assumed.
      </p>
      <button className="button button-primary" onClick={reset}>
        Try again
      </button>
      <a href="/login">Return to sign in</a>
    </main>
  );
}
