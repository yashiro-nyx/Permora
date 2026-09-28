export default function Loading() {
  return (
    <div className="staff-loading" role="status" aria-live="polite">
      <span className="loading-mark" aria-hidden="true" />
      <div>
        <h1>Loading notifications</h1>
        <p>Retrieving your persisted request updates.</p>
      </div>
    </div>
  );
}
