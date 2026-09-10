export default function SearchBar({ query, onQueryChange, mode, onModeChange, onSubmit, result, searching, extractionConfigured }) {
  return (
    <form
      className="search-bar"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div className="search-bar__row">
        <input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={
            mode === 'smart' && extractionConfigured
              ? 'Ask in plain language — “invoices over $100 from Acme”'
              : 'Search by keyword — vendor, filename, doc type…'
          }
          aria-label="Search documents"
        />
        {query && (
          <button type="button" className="search-bar__clear" onClick={() => onQueryChange('')} aria-label="Clear search">
            ✕
          </button>
        )}
        <div className="search-mode-toggle" role="group" aria-label="Search mode">
          <button
            type="button"
            className={mode === 'smart' ? 'is-active' : ''}
            onClick={() => onModeChange('smart')}
            title={extractionConfigured ? 'Ask a question in plain language' : 'Requires ANTHROPIC_API_KEY on the server'}
          >
            Smart
          </button>
          <button type="button" className={mode === 'keyword' ? 'is-active' : ''} onClick={() => onModeChange('keyword')}>
            Keyword
          </button>
        </div>
      </div>

      {searching && <p className="search-bar__status">Searching…</p>}

      {!searching && result && result.modeUsed === 'smart' && result.explanation && (
        <p className="search-bar__status search-bar__status--smart">🔎 {result.explanation}</p>
      )}
      {!searching && result && query && result.modeUsed === 'keyword' && mode === 'smart' && (
        <p className="search-bar__status search-bar__status--fallback">
          Smart search came up empty or isn't configured — showing keyword results instead.
        </p>
      )}
    </form>
  );
}
