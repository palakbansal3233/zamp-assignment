import DocumentCard from './DocumentCard';
import UploadingCard from './UploadingCard';

export default function DocumentGrid({ documents, inFlightUploads, onOpen, emptyState }) {
  const hasNothing = documents.length === 0 && inFlightUploads.length === 0;

  if (hasNothing) return emptyState;

  return (
    <div className="doc-grid">
      {inFlightUploads.map((u) => (
        <UploadingCard key={u.tempId} upload={u} />
      ))}
      {documents.map((doc) => (
        <DocumentCard key={doc._id} doc={doc} onOpen={onOpen} />
      ))}
    </div>
  );
}
