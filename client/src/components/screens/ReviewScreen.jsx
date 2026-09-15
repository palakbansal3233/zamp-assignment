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
              title="Click to highlight the field this text supports"
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
    <div
      className={`field-row${f.lit ? ' is-lit' : ''}${f.needs ? ' needs-check' : ''}`}
      onClick={f.onClick}
      onMouseEnter={f.onEnter}
      onMouseLeave={f.onLeave}
      title="Click to highlight where this field came from in the original"
    >
      <div className="field-row-main">
        <div className="field-label">{f.label}</div>
        <div className={`field-value${f.conflict ? ' is-conflict' : ''}`}>{f.value}</div>
        <div className="field-conf">
          <div className="field-conf-track" title={`Confidence: ${f.pct}%`}>
            <div className="field-conf-fill" style={{ width: `${f.pct}%`, background: f.barColor }} />
          </div>
        </div>
      </div>
      {f.needs && (
        <div className="field-check-row">
          <span className="field-check-note"><i className="ph ph-warning-circle" />{f.checkNote}</span>
          {f.checkActions.map((a, i) => (
            <button
              key={i}
              type="button"
              className="btn btn-secondary"
              title={`Resolve this field as "${a.label}"`}
              onClick={(e) => { e.stopPropagation(); a.run(); }}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyReviewState({ icon, title, text, actionLabel, onAction }) {
  return (
    <div className="notfound-wrap">
      <div className="notfound-inner">
        <i className={icon} style={{ fontSize: 40, color: 'var(--color-neutral-600)' }} />
        <h4>{title}</h4>
        <p>{text}</p>
        {onAction && (
          <div className="notfound-actions">
            <button type="button" className="btn btn-primary" title={actionLabel} onClick={onAction}>{actionLabel}</button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ReviewScreen({ review }) {
  if (review.notFound) {
    return (
      <EmptyReviewState
        icon="ph ph-file-dashed"
        title="This document isn't here anymore"
        text="It may have been deleted — in this tab, another tab, or with Clear all. Go back to your documents to see what's still there."
        actionLabel="Back to my documents"
        onAction={review.goIngest}
      />
    );
  }

  if (review.noSelection) {
    return (
      <EmptyReviewState
        icon="ph ph-file-text"
        title="No document selected"
        text="Pick one of your documents to see what we read from it."
        actionLabel="Go to my documents"
        onAction={review.goIngest}
      />
    );
  }

  return (
    <>
      <div className="review-tabsbar">
        <div className="doc-tabs">
          {review.docTabs.map((t) => (
            <button key={t.id} type="button" className={`doc-tab${t.active ? ' is-active' : ''}`} title={`Switch to "${t.label}"`} onClick={t.go}>{t.label}</button>
          ))}
        </div>
        <div className="review-tabsbar-spacer" />
        <span className="review-meta text-muted">{review.meta}</span>
        <button type="button" className="btn btn-ghost" title="Ask a question grounded in this document" onClick={review.goAsk}>
          <i className="ph ph-sparkle" />Ask this document
        </button>
      </div>

      <div className="review-body">
        <div className="review-pane is-left">
          {review.docLoading && <p className="text-muted" style={{ padding: 'var(--space-8)' }}>Loading document…</p>}
          {!review.docLoading && !review.readable && (
            <div className="doc-unreadable">
              <i className="ph ph-file-dashed" />
              <div className="doc-unreadable-title">{review.unreadableTitle}</div>
              <div className="doc-unreadable-text">{review.unreadableText}</div>
            </div>
          )}
          {!review.docLoading && review.readable && (
            <div className="doc-surface">
              {review.docLines.map((line, i) => <DocLine key={i} line={line} />)}
              {review.truncated && <div className="doc-truncated-note">{review.truncatedNote}</div>}
            </div>
          )}
        </div>

        <div className="review-pane">
          <div className="review-fields-header">
            <div>
              <h6>What we found</h6>
              <div className="review-schema-note">{review.schemaNote}</div>
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              {/* This used to read "Clear", one screen away from a "Clear all"
                  that permanently deletes every document. Same word, wildly
                  different stakes — so this one says what it actually does,
                  and only appears when there is a selection to undo. */}
              {review.active && (
                <button type="button" className="btn btn-ghost" title="Stop highlighting this detail in the document" onClick={review.clearActive}>
                  Unhighlight
                </button>
              )}
              {review.deleteDocument && (
                <button type="button" className="btn btn-ghost" title="Permanently delete this document" onClick={review.deleteDocument}>
                  <i className="ph ph-trash" />Delete this document
                </button>
              )}
            </div>
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
                  <button key={i} type="button" className={`btn ${a.cls}`} title={a.label} onClick={a.run}>{a.label}</button>
                ))}
              </div>
            </div>
          )}

          <div className="field-list">
            {review.fieldRows.map((f) => <FieldRow key={f.id} f={f} />)}
          </div>

          <div className="new-fields-card">
            <div className="new-fields-title">This document was the first to mention</div>
            <div className="new-fields-tags">
              {review.newFields.map((label) => (
                <span key={label} className="tag tag-outline" title={`"${label}" was not seen on any other document before this one`}>{label}</span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
