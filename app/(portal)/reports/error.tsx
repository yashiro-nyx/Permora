"use client";

export default function Error({ reset }: { reset: () => void }) {
  return (
    <section className="alert tone-danger" role="alert">
      <div>
        <strong>Reports could not be loaded</strong>
        <p>Try again. This page only reads data and makes no changes.</p>
        <button className="button button-outline" onClick={reset} type="button">
          Retry
        </button>
      </div>
    </section>
  );
}
