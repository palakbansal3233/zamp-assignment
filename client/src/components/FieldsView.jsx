import { humanizeKey } from '../utils/format';

// Renders an arbitrarily-shaped `fields` object (the whole point of this
// project is we don't know its shape ahead of time) as a readable
// definition list, recursing into nested objects/arrays. Keys present in
// `lowConfidenceFields` get a caution marker so low-confidence extractions
// are visually distinct from ones the model was sure about, instead of
// presenting everything with false uniform confidence.
export default function FieldsView({ fields, lowConfidenceFields = [], path = '' }) {
  const entries = Object.entries(fields || {});
  if (entries.length === 0) {
    return <p className="fields-empty">No structured fields extracted.</p>;
  }

  return (
    <dl className="fields-list">
      {entries.map(([key, value]) => {
        const fullPath = path ? `${path}.${key}` : key;
        const isLowConfidence = lowConfidenceFields.includes(fullPath) || lowConfidenceFields.includes(key);
        return (
          <div className="fields-row" key={fullPath}>
            <dt>
              {humanizeKey(key)}
              {isLowConfidence && (
                <span className="low-confidence-flag" title="Low confidence — verify against the original document">
                  ⚠︎
                </span>
              )}
            </dt>
            <dd>
              <FieldValue value={value} lowConfidenceFields={lowConfidenceFields} path={fullPath} />
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function FieldValue({ value, lowConfidenceFields, path }) {
  if (value === null || value === undefined || value === '') {
    return <span className="field-value field-value--empty">—</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="field-value field-value--empty">—</span>;
    if (value.every((v) => typeof v !== 'object' || v === null)) {
      return <span className="field-value">{value.join(', ')}</span>;
    }
    return (
      <ol className="fields-array">
        {value.map((item, i) => (
          <li key={i}>
            {typeof item === 'object' && item !== null ? (
              <FieldsView fields={item} lowConfidenceFields={lowConfidenceFields} path={`${path}.${i}`} />
            ) : (
              <span className="field-value">{String(item)}</span>
            )}
          </li>
        ))}
      </ol>
    );
  }
  if (typeof value === 'object') {
    return <FieldsView fields={value} lowConfidenceFields={lowConfidenceFields} path={path} />;
  }
  if (typeof value === 'boolean') {
    return <span className="field-value">{value ? 'Yes' : 'No'}</span>;
  }
  return <span className="field-value">{String(value)}</span>;
}
