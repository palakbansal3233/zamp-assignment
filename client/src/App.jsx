import { useCallback, useEffect, useState } from 'react';
import UploadZone from './components/UploadZone';
import SearchBar from './components/SearchBar';
import DocumentGrid from './components/DocumentGrid';
import DocumentDetail from './components/DocumentDetail';
import EmptyState from './components/EmptyState';
import Toasts from './components/Toasts';
import { useToasts } from './hooks/useToasts';
import {
  listDocuments,
  uploadDocument,
  uploadRawText,
  deleteDocument,
  retryDocument,
  searchDocuments,
  getHealth,
} from './api/client';
import { formatBytes } from './utils/format';

const DEFAULT_MAX_FILE_BYTES = 4 * 1024 * 1024;

export default function App() {
  const { toasts, push: pushToast, dismiss: dismissToast } = useToasts();

  const [documents, setDocuments] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const [inFlightUploads, setInFlightUploads] = useState([]);
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [busyDetail, setBusyDetail] = useState(false);

  const [query, setQuery] = useState('');
  const [mode, setMode] = useState('smart');
  const [searchResult, setSearchResult] = useState(null);
  const [searching, setSearching] = useState(false);

  const [health, setHealth] = useState({ extractionConfigured: true, maxFileBytes: DEFAULT_MAX_FILE_BYTES });

  // Initial load: health first (so we know limits/config), then page 1.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const h = await getHealth();
        if (!cancelled) setHealth(h);
      } catch {
        // Non-fatal — we just fall back to defaults and let uploads surface
        // any real problem individually.
      }
      try {
        const res = await listDocuments({ page: 1, limit: 20 });
        if (cancelled) return;
        setDocuments(res.items);
        setTotalPages(res.totalPages);
        setPage(1);
      } catch (err) {
        if (!cancelled) setLoadError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    try {
      const nextPage = page + 1;
      const res = await listDocuments({ page: nextPage, limit: 20 });
      setDocuments((prev) => [...prev, ...res.items]);
      setPage(nextPage);
      setTotalPages(res.totalPages);
    } catch (err) {
      pushToast(err.message, 'error');
    } finally {
      setLoadingMore(false);
    }
  }, [page, pushToast]);

  // --- search (debounced) ---
  useEffect(() => {
    if (!query.trim()) {
      setSearchResult(null);
      setSearching(false);
      return undefined;
    }
    setSearching(true);
    const handle = setTimeout(async () => {
      try {
        const result = await searchDocuments(query.trim(), mode);
        setSearchResult(result);
      } catch (err) {
        pushToast(err.message, 'error');
        setSearchResult(null);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(handle);
  }, [query, mode, pushToast]);

  const isSearchActive = query.trim().length > 0;
  const visibleDocuments = isSearchActive ? searchResult?.items || [] : documents;

  // --- uploads (sequential — see decisions.md) ---
  const runUpload = useCallback(
    async (filename, factory) => {
      const tempId = `${filename}-${Date.now()}-${Math.random()}`;
      setInFlightUploads((prev) => [...prev, { tempId, filename }]);
      try {
        const created = await factory();
        setDocuments((prev) => [created, ...prev]);
        if (created.status === 'error') {
          pushToast(`"${filename}" uploaded, but extraction failed: ${created.errorMessage}`, 'error');
        } else if (created.unreadable) {
          pushToast(`"${filename}" uploaded, but couldn't be read clearly.`, 'warning');
        } else {
          pushToast(`"${filename}" processed ✓`, 'success');
        }
      } catch (err) {
        pushToast(`"${filename}": ${err.message}`, 'error');
      } finally {
        setInFlightUploads((prev) => prev.filter((u) => u.tempId !== tempId));
      }
    },
    [pushToast]
  );

  const handleFiles = useCallback(
    async (files) => {
      const maxBytes = health.maxFileBytes || DEFAULT_MAX_FILE_BYTES;
      for (const file of files) {
        if (file.size > maxBytes) {
          pushToast(`"${file.name}" is too large — max ${formatBytes(maxBytes)}.`, 'error');
          continue;
        }
        // eslint-disable-next-line no-await-in-loop
        await runUpload(file.name, () => uploadDocument(file));
      }
    },
    [health.maxFileBytes, pushToast, runUpload]
  );

  const handleSample = useCallback(
    (sample) => runUpload(sample.filename, () => uploadRawText(sample.filename, sample.text)),
    [runUpload]
  );

  const handleDelete = useCallback(
    async (doc) => {
      if (typeof window !== 'undefined' && !window.confirm(`Delete "${doc.filename}"? This can't be undone.`)) return;
      setBusyDetail(true);
      try {
        await deleteDocument(doc._id);
        setDocuments((prev) => prev.filter((d) => d._id !== doc._id));
        setSelectedDoc(null);
        pushToast(`Deleted "${doc.filename}".`, 'success');
      } catch (err) {
        pushToast(err.message, 'error');
      } finally {
        setBusyDetail(false);
      }
    },
    [pushToast]
  );

  const handleRetry = useCallback(
    async (doc) => {
      setBusyDetail(true);
      try {
        const updated = await retryDocument(doc._id);
        setDocuments((prev) => prev.map((d) => (d._id === updated._id ? updated : d)));
        setSelectedDoc(updated);
        const ok = updated.status === 'done' && !updated.unreadable;
        pushToast(ok ? 'Extraction succeeded ✓' : 'Still could not extract this document.', ok ? 'success' : 'warning');
      } catch (err) {
        pushToast(err.message, 'error');
      } finally {
        setBusyDetail(false);
      }
    },
    [pushToast]
  );

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>Docstack</h1>
          <p className="app-header__tagline">Turn messy documents into structured, queryable data.</p>
        </div>
      </header>

      <main className="app-main">
        <UploadZone onFiles={handleFiles} onSample={handleSample} maxFileBytes={health.maxFileBytes || DEFAULT_MAX_FILE_BYTES} />

        {!loading && !loadError && (documents.length > 0 || inFlightUploads.length > 0) && (
          <SearchBar
            query={query}
            onQueryChange={setQuery}
            mode={mode}
            onModeChange={setMode}
            onSubmit={() => {}}
            result={searchResult}
            searching={searching}
            extractionConfigured={health.extractionConfigured}
          />
        )}

        {loading && <p className="app-main__loading">Loading your documents…</p>}

        {loadError && (
          <EmptyState
            icon="⚠︎"
            title="Couldn't load your documents"
            subtitle={loadError}
          />
        )}

        {!loading && !loadError && (
          <DocumentGrid
            documents={visibleDocuments}
            inFlightUploads={inFlightUploads}
            onOpen={setSelectedDoc}
            emptyState={
              isSearchActive ? (
                <EmptyState icon="🔍" title="No matches" subtitle={`Nothing found for "${query}". Try a different phrase or switch modes.`} />
              ) : (
                <EmptyState
                  icon="📄"
                  title="No documents yet"
                  subtitle="Drop a file above, or try a sample — messy invoices, scribbled notes, scans, even photos of handwriting."
                />
              )
            }
          />
        )}

        {!loading && !loadError && !isSearchActive && page < totalPages && (
          <button type="button" className="load-more" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        )}
      </main>

      {selectedDoc && (
        <DocumentDetail
          doc={selectedDoc}
          onClose={() => setSelectedDoc(null)}
          onDelete={handleDelete}
          onRetry={handleRetry}
          busy={busyDetail}
        />
      )}

      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
