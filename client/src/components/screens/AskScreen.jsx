export default function AskScreen({ ask }) {
  return (
    <div className="ask-scroll">
      <div className="ask-wrap">
        <h6>Ask</h6>
        <h3 className="ask-heading">{ask.heading}</h3>

        <div className="ask-input-row">
          <i className="ph ph-magnifying-glass" />
          <input
            value={ask.draft}
            onChange={(e) => ask.onDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') ask.submit(); }}
            placeholder="Ask across every document…"
          />
          <button type="button" className="btn btn-primary" onClick={ask.submit}>Ask</button>
        </div>

        {ask.busy && (
          <div className="ask-busy-card">
            <div className="ask-busy-row">
              <span>{ask.busyStage}</span>
              <span>{ask.busyPct}%</span>
            </div>
            <div className="ask-busy-track">
              <div className="ask-busy-fill" style={{ width: `${ask.busyPct}%` }} />
            </div>
          </div>
        )}

        {!ask.busy && ask.error && (
          <div className="ask-error-card">
            <div className="ask-error-head">
              <i className={ask.error.icon} />
              <span>{ask.error.title}</span>
            </div>
            <div className="ask-error-text">{ask.error.text}</div>
            <div className="ask-error-actions">
              {ask.error.actions.map((a, i) => (
                <button key={i} type="button" className={`btn ${a.cls}`} onClick={a.run}>{a.label}</button>
              ))}
            </div>
            {ask.error.code && <div className="ask-error-code">{ask.error.code}</div>}
          </div>
        )}

        {!ask.busy && ask.answer && (
          <div className="ask-answer-card">
            <div className="ask-answer-question">{ask.answer.question}</div>
            <div className="ask-answer-text">{ask.answer.text}</div>
            {ask.answer.caveat && <div className="ask-answer-caveat">{ask.answer.caveat}</div>}
            <div className="ask-citations">
              <span className="ask-citations-label">Read from</span>
              {ask.answer.citations.map((c, i) => (
                <button key={i} type="button" className="citation-chip" onClick={c.go}>
                  <i className="ph ph-file-text" />{c.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="suggestions-header">
          <h6>Questions this corpus can answer</h6>
          <span className="suggestions-hint">ranked by how completely the data supports an answer</span>
        </div>

        <div className="suggestions-list">
          {ask.suggestions.map((q) => (
            <button key={q.rank} type="button" className="suggestion-row" onClick={q.ask}>
              <span className="suggestion-rank">{q.rank}</span>
              <span className="suggestion-text">{q.text}</span>
              <span className="suggestion-source">{q.source}</span>
              <span className="suggestion-bar-track">
                <span className="suggestion-bar-fill" style={{ width: `${Math.round(q.score * 100)}%`, background: q.score >= 0.85 ? 'var(--color-accent)' : 'var(--color-accent-600)' }} />
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
