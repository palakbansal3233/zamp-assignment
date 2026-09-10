import { useEffect } from 'react';
import StatusBadge from './StatusBadge';
import DocTypeBadge from './DocTypeBadge';
import FieldsView from './FieldsView';
import { fileUrl } from '../api/client';
import { formatBytes, formatDate } from '../utils/format';

export default function DocumentDetail({ doc, onClose, onDelete, onRetry, busy }) {
  useEffect(() => {
    const onKeyDown = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const isImage = doc.mimeType?.startsWith('image/');
  const src = fileUrl(doc._id);

  return (
    <div className="detail-overlay" onClick={onClose}>
      <div className="detail-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={doc.filename}>
        <header className="detail-panel__header">
          <div>
            <h2>{doc.filename}</h2>
            <div className="detail-panel__meta">
              <StatusBadge status={doc.status} />
              {doc.status === 'done' && !doc.unreadable && <DocTypeBadge docType={doc.docType} />}
              <span>{formatBytes(doc.sizeBytes)}</span>
              <span>{formatDate(doc.createdAt)}</span>
            </div>
          </div>
          <button type="button" className="detail-panel__close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="detail-panel__body">
          <div className="detail-panel__preview">
            {isImage ? (
              <img src={src} alt={doc.filename} />
            ) : (
              <iframe src={src} title={doc.filename} />
            )}
            <a className="detail-panel__open-raw" href={src} target="_blank" rel="noreferrer">
              Open original in new tab ↗
            </a>
          </div>

          <div className="detail-panel__data">
            {doc.status === 'processing' && <p className="detail-panel__status-msg">Still processing — check back in a moment.</p>}

            {doc.status === 'error' && (
              <div className="callout callout--error">
                <strong>Extraction failed</strong>
                <p>{doc.errorMessage}</p>
                <button type="button" onClick={() => onRetry(doc)} disabled={busy}>
                  {busy ? 'Retrying…' : 'Retry extraction'}
                </button>
              </div>
            )}

            {doc.status === 'done' && doc.unreadable && (
              <div className="callout callout--warning">
                <strong>Couldn't read this document</strong>
                <p>{doc.unreadableReason || 'The content was not legible enough to extract structured data.'}</p>
                <button type="button" onClick={() => onRetry(doc)} disabled={busy}>
                  {busy ? 'Retrying…' : 'Try again'}
                </button>
              </div>
            )}

            {doc.status === 'done' && !doc.unreadable && (
              <>
                {doc.summary && <p className="detail-panel__summary">{doc.summary}</p>}
                {doc.lowConfidenceFields?.length > 0 && (
                  <p className="detail-panel__confidence-note">
                    ⚠︎ Fields marked with a caution icon were uncertain — double-check them against the original.
                  </p>
                )}
                <FieldsView fields={doc.fields} lowConfidenceFields={doc.lowConfidenceFields} />
              </>
            )}

            <button type="button" className="detail-panel__delete" onClick={() => onDelete(doc)} disabled={busy}>
              Delete document
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
