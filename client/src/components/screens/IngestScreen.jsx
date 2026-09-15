import { useRef, useState } from 'react';
import { SAMPLE_DOCUMENTS } from '../../sampleDocuments';

function QueueRow({ item, onOpen }) {
  const rowClass = `queue-row${item.status === 'pending' ? ' is-pending' : ''}${item.status === 'failed' ? ' is-failed' : ''}`;
  const tagClass = item.status === 'failed' ? 'tag tag-outline' : item.status === 'pending' ? 'tag tag-neutral' : 'tag tag-accent';

  return (
    <div className={rowClass}>
      <div
        className={`queue-row-main${item.clickable ? ' is-clickable' : ''}`}
        onClick={item.clickable ? () => onOpen(item.id) : undefined}
        title={item.clickable ? `Open "${item.name}" in Review` : item.name}
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
              <div className="queue-bar-track" title={item.stage}>
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
            <button key={i} type="button" className={`btn ${a.cls}`} title={a.label} onClick={a.run}>{a.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

// The design prototype's dropzone was decorative (clicking it just jumped
// to a fixed demo screen). Real Ingest needs an actual file picker and real
// drag-and-drop — `ingest.onFiles`, when present, is what makes that real;
// its absence (the demo engine never sets it) keeps the original
// click-to-demo behavior working unchanged for demo-only scenarios.
export default function IngestScreen({ ingest }) {
  const fileInputRef = useRef(null);
  const [dragActive, setDragActive] = useState(false);
  const hasRealUpload = typeof ingest.onFiles === 'function';

  const openPicker = () => {
    if (ingest.dropDisabled) return;
    if (hasRealUpload) fileInputRef.current?.click();
    else ingest.addDoc();
  };

  return (
    <>
      <div className="ingest-header">
        <div>
          <h6>My documents</h6>
          <h3>Add a document. We&rsquo;ll read it for you.</h3>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          {ingest.deleteAll && ingest.canDeleteAll && (
            <button
              type="button"
              className="btn btn-ghost"
              title="Permanently delete every document here"
              disabled={ingest.deletingAll}
              onClick={ingest.deleteAll}
            >
              <i className="ph ph-trash" />{ingest.deletingAll ? 'Deleting…' : 'Clear all'}
            </button>
          )}
          <button type="button" className="btn btn-primary" title="Choose a file to upload" onClick={openPicker}>
            <i className="ph ph-plus" />Add document
          </button>
        </div>
      </div>

      <div className="ingest-body">
        {hasRealUpload && (
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            accept=".pdf,.docx,.png,.jpg,.jpeg,.webp,.gif,.txt,.md,.csv,.json,.log,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*,text/*"
            onChange={(e) => {
              if (e.target.files.length) ingest.onFiles(Array.from(e.target.files));
              e.target.value = '';
            }}
          />
        )}
        <div
          className={`dropzone${ingest.dropDisabled ? ' is-disabled' : ''}${dragActive ? ' is-drag-active' : ''}`}
          onClick={openPicker}
          title={ingest.dropDisabled ? 'Uploads are unavailable right now' : 'Click to choose a file, or drop one here'}
          onDragOver={(e) => {
            if (!hasRealUpload || ingest.dropDisabled) return;
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => {
            if (!hasRealUpload || ingest.dropDisabled) return;
            e.preventDefault();
            setDragActive(false);
            if (e.dataTransfer.files.length) ingest.onFiles(Array.from(e.dataTransfer.files));
          }}
        >
          <i className="ph ph-tray-arrow-down dropzone-icon" />
          <div className="dropzone-title">Drag a file here, or click to choose one</div>
          <div className="dropzone-note text-muted">{ingest.dropNote}</div>
        </div>

        {/* Only while there's nothing to look at — once you have your own
            documents, sample chips are clutter. */}
        {ingest.onSample && ingest.items.length === 0 && (
          <div className="sample-row">
            <span className="sample-row__label text-muted">Nothing to hand? Try one:</span>
            {SAMPLE_DOCUMENTS.map((sample) => (
              <button
                key={sample.filename}
                type="button"
                className="sample-chip"
                title={`Read a sample ${sample.label.toLowerCase()} to see how this works`}
                onClick={() => ingest.onSample(sample)}
              >
                {sample.label}
              </button>
            ))}
          </div>
        )}

        <div className="queue-heading-row">
          <h6>Your documents</h6>
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
