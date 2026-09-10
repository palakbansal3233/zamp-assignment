function QueueRow({ item, onOpen }) {
  const rowClass = `queue-row${item.status === 'pending' ? ' is-pending' : ''}${item.status === 'failed' ? ' is-failed' : ''}`;
  const tagClass = item.status === 'failed' ? 'tag tag-outline' : item.status === 'pending' ? 'tag tag-neutral' : 'tag tag-accent';

  return (
    <div className={rowClass}>
      <div
        className={`queue-row-main${item.clickable ? ' is-clickable' : ''}`}
        onClick={item.clickable ? () => onOpen(item.id) : undefined}
      >
        <i className={`${item.icon} queue-icon${item.status !== 'done' ? ' is-muted' : ''}`} />
        <div className="queue-info">
          <div className="queue-name">{item.name}</div>
          <div className={`queue-sub${item.status === 'failed' ? ' is-failed' : ''}`}>{item.sub}</div>
        </div>
        <span className={tagClass}>{item.kind}</span>
        <div className="queue-status">
          {item.status === 'pending' && (
            <>
              <div className="queue-bar-track">
                <div
                  className={`queue-bar-fill${item.stalled || item.paused ? ' is-stalled' : ''}`}
                  style={{ width: `${item.pct}%` }}
                />
              </div>
              <div className="queue-stage">{item.stage}</div>
            </>
          )}
          {item.status === 'done' && (
            <>
              <div className="queue-fieldcount">{item.fieldCount}</div>
              <div className="queue-flag">{item.flagLabel}</div>
            </>
          )}
        </div>
      </div>
      {item.actions && item.actions.length > 0 && (
        <div className="queue-actions">
          {item.actions.map((a, i) => (
            <button key={i} type="button" className={`btn ${a.cls}`} onClick={a.run}>{a.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function IngestScreen({ ingest }) {
  return (
    <>
      <div className="ingest-header">
        <div>
          <h6>Ingest</h6>
          <h3>Drop anything in. We work out the shape.</h3>
        </div>
        <button type="button" className="btn btn-primary" onClick={ingest.addDoc}>
          <i className="ph ph-plus" />Add document
        </button>
      </div>

      <div className="ingest-body">
        <div
          className={`dropzone${ingest.dropDisabled ? ' is-disabled' : ''}`}
          onClick={ingest.dropDisabled ? undefined : ingest.addDoc}
        >
          <i className="ph ph-tray-arrow-down dropzone-icon" />
          <div className="dropzone-title">Drop PDFs, scans, emails, spreadsheets</div>
          <div className="dropzone-note text-muted">{ingest.dropNote}</div>
        </div>

        <div className="queue-heading-row">
          <h6>Queue</h6>
          <span className="ready-label text-muted">{ingest.readyLabel}</span>
        </div>

        <div className="queue-list">
          {ingest.items.map((item) => (
            <QueueRow key={item.id} item={item} onOpen={ingest.openDoc} />
          ))}
        </div>
      </div>
    </>
  );
}
