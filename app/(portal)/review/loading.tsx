export default function Loading() {
  return (
    <div className="staff-loading" role="status" aria-live="polite">
      <span className="loading-mark" aria-hidden="true" />
      <div>
        <h1>Loading review workspace</h1>
        <p>Retrieving protected request information…</p>
      </div>
    </div>
  );
}
