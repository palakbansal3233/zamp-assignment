export default function SessionDialog({ session }) {
  if (!session.open) return null;
  return (
    <div className="session-dialog-backdrop">
      <div className="dialog" style={{ maxWidth: 400 }}>
        <div className="dialog-title">Your session expired</div>
        <div className="dialog-body" style={{ textWrap: 'pretty' }}>
          You were signed out after 30 minutes idle. Two field confirmations from this review are held locally
          and will be submitted when you sign back in.
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={session.dismiss}>Keep reading</button>
          <button type="button" className="btn btn-primary" onClick={session.dismiss}>Sign back in</button>
        </div>
      </div>
    </div>
  );
}
