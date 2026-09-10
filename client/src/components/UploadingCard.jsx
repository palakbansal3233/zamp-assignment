export default function UploadingCard({ upload }) {
  return (
    <div className={`doc-card doc-card--uploading ${upload.error ? 'doc-card--error' : ''}`}>
      <div className="doc-card__top">
        <span className="doc-card__filename" title={upload.filename}>
          {upload.filename}
        </span>
        {!upload.error && <span className="spinner" aria-label="Uploading" />}
      </div>
      <p className="doc-card__summary">
        {upload.error ? upload.error : 'Uploading and extracting structured data…'}
      </p>
    </div>
  );
}
