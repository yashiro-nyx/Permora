"use client";

export default function Error({ reset }: { reset: () => void }) {
  return (
    <section className="alert tone-danger" role="alert">
      <div>
        <strong>Permissions could not be loaded</strong>
        <p>Try again. No permission changes were made by this page load.</p>
        <button className="button button-outline" onClick={reset} type="button">
          Retry
        </button>
      </div>
    </section>
  );
}
