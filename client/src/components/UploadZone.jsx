import { useCallback, useRef, useState } from 'react';
import { formatBytes } from '../utils/format';
import { SAMPLE_DOCUMENTS } from '../sampleDocuments';

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.txt,.md,.csv,application/pdf,image/*,text/*';

export default function UploadZone({ onFiles, onSample, maxFileBytes, disabled }) {
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef(null);

  const handleFiles = useCallback(
    (fileList) => {
      const files = Array.from(fileList);
      if (files.length === 0) return;
      onFiles(files);
    },
    [onFiles]
  );

  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDragActive(false);
      if (disabled) return;
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles, disabled]
  );

  return (
    <div className="upload-zone-wrap">
      <div
        className={`upload-zone ${dragActive ? 'upload-zone--active' : ''} ${disabled ? 'upload-zone--disabled' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={onDrop}
        onClick={() => !disabled && inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (!disabled && (e.key === 'Enter' || e.key === ' ')) inputRef.current?.click();
        }}
        aria-label="Upload documents"
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          hidden
          disabled={disabled}
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <div className="upload-zone__icon" aria-hidden="true">
          ⬆
        </div>
        <p className="upload-zone__title">Drop documents here, or click to browse</p>
        <p className="upload-zone__hint">
          PDF, photo/scan (PNG, JPEG, WEBP), or plain text/CSV — up to {formatBytes(maxFileBytes)} each
        </p>
      </div>

      <div className="sample-row">
        <span className="sample-row__label">No file handy?</span>
        {SAMPLE_DOCUMENTS.map((sample) => (
          <button key={sample.filename} type="button" className="sample-chip" disabled={disabled} onClick={() => onSample(sample)}>
            Try “{sample.label}”
          </button>
        ))}
      </div>
    </div>
  );
}
