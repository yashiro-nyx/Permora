export default function Loading() {
  return (
    <div className="staff-loading" role="status" aria-live="polite">
      <span className="loading-mark" aria-hidden="true" />
      <div>
        <h1>Loading audit logs</h1>
        <p>Retrieving immutable administrator-visible events.</p>
      </div>
    </div>
  );
}
