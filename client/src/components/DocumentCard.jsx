import StatusBadge from './StatusBadge';
import DocTypeBadge from './DocTypeBadge';
import { formatDate } from '../utils/format';

export default function DocumentCard({ doc, onOpen }) {
  return (
    <button type="button" className={`doc-card doc-card--${doc.status}`} onClick={() => onOpen(doc)}>
      <div className="doc-card__top">
        <span className="doc-card__filename" title={doc.filename}>
          {doc.filename}
        </span>
        <StatusBadge status={doc.status} />
      </div>

      {doc.status === 'done' && !doc.unreadable && <DocTypeBadge docType={doc.docType} />}
      {doc.status === 'done' && doc.unreadable && <span className="doctype-badge doctype-badge--muted">Unreadable</span>}

      <p className="doc-card__summary">
        {doc.status === 'processing' && 'Reading the document and extracting structured fields…'}
        {doc.status === 'error' && (doc.errorMessage || 'Something went wrong while processing this document.')}
        {doc.status === 'done' && (doc.summary || 'No summary available.')}
      </p>

      <span className="doc-card__date">{formatDate(doc.createdAt)}</span>
    </button>
  );
}
