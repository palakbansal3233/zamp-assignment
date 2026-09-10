function DocLine({ line }) {
  if (line.kind === 'gap') return <div className="docline-gap" />;
  const cls = `docline docline-${line.kind}`;
  return (
    <div className={cls}>
      <div className="docline-left">
        {line.segments.map((seg, i) =>
          seg.fieldId ? (
            <span
              key={i}
              className={`doc-seg${seg.lit ? ' is-lit' : ''}`}
              onClick={seg.onClick}
              onMouseEnter={seg.onEnter}
              onMouseLeave={seg.onLeave}
            >
              {seg.text}
            </span>
          ) : (
            <span key={i}>{seg.text}</span>
          )
        )}
      </div>
      {line.amt && <span className="docline-amt">{line.amt}</span>}
    </div>
  );
}

function FieldRow({ f }) {
  return (
    <div className={`field-row${f.lit ? ' is-lit' : ''}${f.needs ? ' needs-check' : ''}`} onClick={f.onClick} onMouseEnter={f.onEnter} onMouseLeave={f.onLeave}>
      <div className="field-row-main">
        <div className="field-label">{f.label}</div>
        <div className={`field-value${f.conflict ? ' is-conflict' : ''}`}>{f.value}</div>
        <div className="field-conf">
          <div className="field-conf-track">
            <div className="field-conf-fill" style={{ width: `${f.pct}%`, background: f.barColor }} />
          </div>
        </div>
      </div>
      {f.needs && (
        <div className="field-check-row">
          <span className="field-check-note"><i className="ph ph-warning-circle" />{f.checkNote}</span>
          {f.checkActions.map((a, i) => (
            <button key={i} type="button" className="btn btn-secondary" onClick={(e) => { e.stopPropagation(); a.run(); }}>{a.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ReviewScreen({ review }) {
  return (
    <>
      <div className="review-tabsbar">
        <div className="doc-tabs">
          {review.docTabs.map((t) => (
            <button key={t.id} type="button" className={`doc-tab${t.active ? ' is-active' : ''}`} onClick={t.go}>{t.label}</button>
          ))}
        </div>
        <div className="review-tabsbar-spacer" />
        <span className="review-meta text-muted">{review.meta}</span>
        <button type="button" className="btn btn-ghost" onClick={review.goAsk}><i className="ph ph-sparkle" />Ask this document</button>
      </div>

      <div className="review-body">
        <div className="review-pane is-left">
          {!review.readable && (
            <div className="doc-unreadable">
              <i className="ph ph-file-dashed" />
              <div className="doc-unreadable-title">{review.unreadableTitle}</div>
              <div className="doc-unreadable-text">{review.unreadableText}</div>
            </div>
          )}
          {review.readable && (
            <div className="doc-surface">
              {review.docLines.map((line, i) => <DocLine key={i} line={line} />)}
              {review.truncated && <div className="doc-truncated-note">{review.truncatedNote}</div>}
            </div>
          )}
        </div>

        <div className="review-pane">
          <div className="review-fields-header">
            <div>
              <h6>Inferred record</h6>
              <div className="review-schema-note">{review.schemaNote}</div>
            </div>
            <button type="button" className="btn btn-ghost" onClick={review.clearActive}>Clear</button>
          </div>

          {review.notice && (
            <div className="extraction-notice">
              <div className="extraction-notice-row">
                <i className={review.notice.icon} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="extraction-notice-title">{review.notice.title}</div>
                  <div className="extraction-notice-text">{review.notice.text}</div>
                </div>
              </div>
              <div className="extraction-notice-actions">
                {review.notice.actions.map((a, i) => (
                  <button key={i} type="button" className={`btn ${a.cls}`} onClick={a.run}>{a.label}</button>
                ))}
              </div>
            </div>
          )}

          <div className="field-list">
            {review.fieldRows.map((f) => <FieldRow key={f.id} f={f} />)}
          </div>

          <div className="new-fields-card">
            <div className="new-fields-title">Fields this document added to the dataset</div>
            <div className="new-fields-tags">
              {review.newFields.map((label) => (
                <span key={label} className="tag tag-outline">{label}</span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
