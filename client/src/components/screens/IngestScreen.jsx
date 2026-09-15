import { useRef, useState } from 'react';
import { SAMPLE_DOCUMENTS } from '../../sampleDocuments';
import { groupByCategory } from '../../utils/categories';

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
              {item.stage && <div className="queue-stage">{item.stage}</div>}
            </>
          )}
          {item.status === 'done' && (
            <>
              <div className="queue-fieldcount">{item.fieldCount}</div>
              <div className="queue-flag">{item.flagLabel}</div>
            </>
          )}
          {item.clickable && (
            /* An explicit way in. The whole row has always been clickable,
               but a click target you can only discover by guessing isn't an
               affordance — and "open this" is the single most common thing
               someone wants from a row. */
            <button
              type="button"
              className="btn btn-secondary queue-preview-btn"
              title={`Open "${item.name}" to see what we read from it`}
              onClick={(e) => { e.stopPropagation(); onOpen(item.id); }}
            >
              <i className="ph ph-eye" />Preview
            </button>
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

      <div className={`ingest-body${ingest.items.length === 0 ? ' is-empty' : ''}`}>
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

        {/* Nothing here yet is a normal, frequent state — especially now
            that every visit starts empty on purpose. It deserves an actual
            message rather than a heading over a void. */}
        {ingest.items.length === 0 ? null : (
          <>
            <div className="queue-heading-row">
              <h6>Your documents</h6>
              <div className="queue-heading-right">
                {ingest.readyLabel && <span className="ready-label text-muted">{ingest.readyLabel}</span>}
                {/* Only worth showing once there's enough to reorder — a sort
                    control above two documents is a control for its own sake. */}
                {ingest.sortOptions && ingest.items.length > 1 && (
                  <label className="sort-control" title="Change the order your documents are listed in">
                    <span className="sort-control-label">Sort</span>
                    <select value={ingest.sortBy} onChange={(e) => ingest.onSort(e.target.value)}>
                      {ingest.sortOptions.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                    <i className="ph ph-caret-down" />
                  </label>
                )}
              </div>
            </div>
            <DocumentList items={ingest.items} onOpen={ingest.openDoc} />
          </>
        )}
      </div>
    </>
  );
}

/**
 * Groups documents under the category they were sorted into, so a long list
 * reads as "your agreements, your bills, your health stuff" rather than one
 * undifferentiated pile. Falls back to a plain list when nothing carries a
 * category (the demo fixtures don't) — a single heading over a single group
 * is just noise.
 */
function DocumentList({ items, onOpen }) {
  const groups = groupByCategory(items);

  if (!groups) {
    return (
      <div className="queue-list">
        {items.map((item) => <QueueRow key={item.id} item={item} onOpen={onOpen} />)}
      </div>
    );
  }

  return (
    <div className="queue-groups">
      {groups.map((group) => (
        <section key={group.id} className="queue-group">
          <div className="queue-group-head">
            <i className={`${group.icon} queue-group-icon`} />
            <span className="queue-group-label">{group.label}</span>
            <span className="queue-group-count">{group.items.length}</span>
          </div>
          <div className="queue-list">
            {group.items.map((item) => <QueueRow key={item.id} item={item} onOpen={onOpen} />)}
          </div>
        </section>
      ))}
    </div>
  );
}
