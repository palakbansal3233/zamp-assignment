import { useCallback, useEffect, useState } from 'react';
import { useSiftDemo } from './useSiftDemo';
import { useToasts } from '../hooks/useToasts';
import * as api from '../api/client';
import { endSessionOnUnload } from '../api/session';
import { buildProvenanceLines } from '../utils/provenance';
import { categoryFor } from '../utils/categories';
import { SCENARIOS } from '../mock/data';

// Real Sift engine — the Phase B replacement for useSiftDemo. It composes
// real API state with the (still fully working) demo engine rather than
// reimplementing 15 illustrative scenarios from scratch: useSiftDemo is
// always called (rules of hooks), and its output is used verbatim for the
// scenarios that still need infrastructure this project doesn't build
// (auth, billing, an offline queue) — everything else is driven by the
// real backend. See decisions.md.
const REAL_SCENARIO_IDS = new Set(['ok', 'upload', 'reject', 'blank', 'nocite', '404']);
const DEMO_SCENARIO_IDS = new Set(SCENARIOS.map((s) => s.id).filter((id) => !REAL_SCENARIO_IDS.has(id)));

const DOC_TYPE_ICONS = {
  invoice: 'ph ph-receipt',
  receipt: 'ph ph-receipt',
  contract: 'ph ph-scroll',
  resume: 'ph ph-user-circle',
  form: 'ph ph-note-pencil',
  letter: 'ph ph-envelope-simple-open',
  handwritten_note: 'ph ph-notepad',
};
function iconForDocType(docType) {
  return DOC_TYPE_ICONS[docType] || 'ph ph-file-text';
}

// Document types are machine keys (`rental_agreement`, `book_page`). They were
// reaching the screen raw, which reads like a database dump to anyone who
// isn't a developer.
function prettyDocType(docType) {
  if (!docType) return 'document';
  const words = String(docType).replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function confidenceColor(conf) {
  if (conf == null) return 'var(--color-neutral-500)';
  if (conf >= 0.9) return 'var(--color-accent)';
  if (conf >= 0.8) return 'var(--color-accent-600)';
  return 'var(--color-neutral-500)';
}

function humanizeKey(key) {
  return String(key).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// Compound values (a prescription's medication list, an invoice's line
// items) are genuinely nested — but the person reading this is trying to
// find out what to take and when, and `JSON.stringify` is not an answer to
// that question. Render nested values as readable lines instead.
function formatOneValue(value) {
  if (value === null || value === undefined || value === '') return '—';
  // A raw `true` in a value column reads like a database dump. The person
  // looking at this wants an answer to "is there highlighted text on this
  // page?", and that answer is Yes.
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value !== 'object') return String(value);
  if (Array.isArray(value)) return value.map(formatOneValue).join(', ');
  return Object.entries(value)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${humanizeKey(k)}: ${typeof v === 'object' ? formatOneValue(v) : v}`)
    .join(' · ');
}

function formatFieldValue(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) {
    if (value.length === 0) return '—';
    // One entry per line — a list of three medicines should read as three
    // things, not one run-on string.
    return value.map(formatOneValue).join('\n');
  }
  if (typeof value === 'object') return formatOneValue(value);
  return String(value);
}

function base64ToFile(base64, filename, mimeType) {
  const byteChars = atob(base64);
  const bytes = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i += 1) bytes[i] = byteChars.charCodeAt(i);
  return new File([bytes], filename, { type: mimeType });
}
const BLANK_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

export function useSift() {
  const demo = useSiftDemo(); // kept alive so DEMO_SCENARIO_IDS keep working exactly as before
  const { toasts, push: pushToast, dismiss: dismissToast } = useToasts();

  const [screen, setScreen] = useState('ingest');
  const [scen, setScen] = useState('ok');
  const [statesOpen, setStatesOpen] = useState(false);

  const [health, setHealth] = useState({ extractionConfigured: true, maxFileBytes: 4 * 1024 * 1024 });
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [inFlight, setInFlight] = useState([]); // [{tempId, filename}]
  const [failedUploads, setFailedUploads] = useState([]); // [{id,name,kind,icon,sub,actions}]

  const [docId, setDocId] = useState(null);
  const [openDocData, setOpenDocData] = useState(null);
  const [docLoading, setDocLoading] = useState(false);
  const [docNotFound, setDocNotFound] = useState(false);
  const [active, setActive] = useState(null);
  const [hover, setHover] = useState(null);
  const [confirmingKey, setConfirmingKey] = useState(null);
  const [deletingAll, setDeletingAll] = useState(false);

  const [askDraft, setAskDraft] = useState('');
  const [askBusy, setAskBusy] = useState(false);
  const [askResult, setAskResult] = useState(null);
  const [suggestions, setSuggestions] = useState([]);

  const [chatOpen, setChatOpen] = useState(false);
  const [chatBadge, setChatBadge] = useState(true);
  const [chatDraft, setChatDraft] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [chatMsgs, setChatMsgs] = useState([{ role: 'bot', text: 'Ask in plain words — I answer only from fields I can point at, and I\'ll say so if nothing supports an answer.' }]);

  const refreshSuggestions = useCallback(async () => {
    try {
      const res = await api.getSuggestions();
      setSuggestions(res.questions || []);
    } catch {
      // Non-fatal — the suggestions list just stays empty/stale.
    }
  }, []);

  // A failed initial load (server unreachable, DB down) is a fundamentally
  // different situation from "there are just no documents yet" — showing
  // an empty queue for the former is actively misleading, so it gets its
  // own error state instead of silently falling through to an empty list.
  const loadDocuments = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await api.listDocuments({ page: 1, limit: 50 });
      setDocuments(res.items);
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Your documents leave when you do.
  //
  // `pagehide` rather than `beforeunload`: beforeunload is unreliable on
  // mobile, where a tab is usually discarded rather than closed, and it
  // can't be trusted to fire at all on iOS. pagehide covers the ways a page
  // actually goes away in practice. `visibilitychange` is deliberately NOT
  // used — switching tabs to look something up would wipe your work.
  //
  // This is best-effort by nature (a crashed browser says nothing), which is
  // why the server also expires a session's documents on a TTL. Belt and
  // braces, because "it deleted my documents, probably" isn't a privacy
  // promise worth making.
  useEffect(() => {
    const goodbye = () => endSessionOnUnload();
    window.addEventListener('pagehide', goodbye);
    return () => window.removeEventListener('pagehide', goodbye);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const h = await api.getHealth();
        if (!cancelled) setHealth(h);
      } catch {
        /* fall back to defaults */
      }
      if (!cancelled) await loadDocuments();
      if (!cancelled) refreshSuggestions();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openDoc = useCallback(async (id, fieldKey) => {
    setDocId(id);
    setActive(fieldKey || null);
    setScreen('review');
    setDocLoading(true);
    setDocNotFound(false);
    setOpenDocData(null);
    try {
      const full = await api.getDocument(id);
      setOpenDocData(full);
    } catch (err) {
      setOpenDocData(null);
      // A document can legitimately disappear out from under an open tab —
      // deleted in another tab, or via "Clear all". Distinguish that (show
      // the real 404 screen) from "something's actually broken" (show the
      // generic unreadable-style message with the real error).
      if (err.status === 404) setDocNotFound(true);
      else pushToast(`Couldn't load that document: ${err.message}`, 'error');
    } finally {
      setDocLoading(false);
    }
  }, [pushToast]);

  // A long document comes back from the upload still `processing`, with
  // however much was read so far already saved. Keep asking it to continue
  // until it's finished — each call is another bounded slice of reading,
  // and each one lands real, visible progress. The guard is there so a
  // server that somehow never advances can't spin the browser forever.
  // Which documents this tab is actively reading — so a document being read
  // right now shows progress, while one left stranded by an earlier session
  // offers a way to pick it back up.
  const [resumingIds, setResumingIds] = useState([]);

  const resumeUntilDone = useCallback(async (id) => {
    let current = null;
    let lastCompleted = -1;

    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        // eslint-disable-next-line no-await-in-loop
        current = await api.resumeDocument(id);
      } catch (err) {
        // A request can die (an edge timeout, a dropped connection) *after*
        // the server already saved chunks — the work isn't lost, only the
        // response is. Re-read the document: if it moved forward, carry on
        // as if nothing happened. Only give up if it genuinely didn't.
        // eslint-disable-next-line no-await-in-loop
        const refetched = await api.getDocument(id).catch(() => null);
        if (!refetched || (refetched.extraction?.completedChunks ?? 0) <= lastCompleted) throw err;
        current = refetched;
      }

      setDocuments((prev) => prev.map((d) => (d._id === id ? current : d)));
      if (current.status !== 'processing') break;

      const completed = current.extraction?.completedChunks ?? 0;
      if (completed <= lastCompleted) {
        // Still 'processing' but no forward progress — stop rather than
        // hammer the server in a loop that can't finish.
        throw new Error('Reading stalled partway through this document. The parts already read are saved — retry to continue.');
      }
      lastCompleted = completed;
    }
    return current;
  }, []);

  // ---- uploads ----
  const runUpload = useCallback(
    async (filename, factory) => {
      const tempId = `${filename}-${Date.now()}-${Math.random()}`;
      setInFlight((prev) => [...prev, { tempId, filename }]);
      try {
        let created = await factory();
        // Drop the placeholder the moment the real document exists, not in
        // the `finally` below. Reading a long document keeps this function
        // running for another half-minute or more, and leaving the
        // placeholder up meant a 10-page agreement showed *two* rows both
        // saying "Reading…" — one real, one a ghost of itself.
        setInFlight((prev) => prev.filter((u) => u.tempId !== tempId));
        setDocuments((prev) => [created, ...prev]);
        if (created.status === 'processing') {
          const id = created._id;
          setResumingIds((prev) => [...prev, id]);
          try {
            created = (await resumeUntilDone(id)) || created;
          } catch (err) {
            // Reading stopped partway. What was already read is saved and
            // visible, and the row offers "Continue reading" to pick it
            // back up. Don't throw the whole upload away over it.
            pushToast(`"${filename}" was partly read — ${err.message}`, 'warning');
          } finally {
            setResumingIds((prev) => prev.filter((x) => x !== id));
          }
        }
        refreshSuggestions();
        return created;
      } catch (err) {
        setFailedUploads((prev) => [
          ...prev,
          {
            id: tempId,
            name: filename,
            kind: 'Upload failed',
            icon: 'ph ph-file-x',
            sub: err.message,
            actions: [{ label: 'Dismiss', cls: 'btn-ghost', run: () => setFailedUploads((p) => p.filter((f) => f.id !== tempId)) }],
          },
        ]);
        return null;
      } finally {
        setInFlight((prev) => prev.filter((u) => u.tempId !== tempId));
      }
    },
    [refreshSuggestions, resumeUntilDone, pushToast]
  );

  const handleFiles = useCallback(
    async (files) => {
      for (const file of files) {
        // eslint-disable-next-line no-await-in-loop
        await runUpload(file.name, () => api.uploadDocument(file));
      }
    },
    [runUpload]
  );

  const handleContinueReading = useCallback(
    async (id) => {
      setResumingIds((prev) => [...prev, id]);
      try {
        await resumeUntilDone(id);
        refreshSuggestions();
      } catch (err) {
        pushToast(err.message, 'warning');
      } finally {
        setResumingIds((prev) => prev.filter((x) => x !== id));
      }
    },
    [resumeUntilDone, refreshSuggestions, pushToast]
  );

  const handleRetryDocument = useCallback(
    async (id) => {
      setResumingIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
      try {
        const updated = await api.retryDocument(id);
        setDocuments((prev) => prev.map((d) => (d._id === updated._id ? updated : d)));
        if (docId === id) setOpenDocData((prev) => (prev ? { ...prev, ...updated } : updated));

        // A retry only reads as much as one request's budget allows, so on a
        // multi-page document it comes back still `processing`. Carry it
        // through to the end rather than leaving the person to press a second
        // button to finish what they already asked for.
        if (updated.status === 'processing') {
          const finished = await resumeUntilDone(id);
          if (finished && docId === id) setOpenDocData(finished);
        }
      } catch (err) {
        pushToast(`Couldn't finish reading that document: ${err.message}`, 'warning');
      } finally {
        setResumingIds((prev) => prev.filter((x) => x !== id));
      }
    },
    [docId, pushToast, resumeUntilDone]
  );

  // ---- field confirm/resolve ----
  const handleConfirmField = useCallback(
    async (key, resolvedAction) => {
      if (!docId) return;
      setConfirmingKey(key);
      try {
        const updated = await api.confirmField(docId, key, { confirmed: true, resolvedAction });
        setOpenDocData((prev) => (prev ? { ...prev, ...updated } : updated));
        setDocuments((prev) => prev.map((d) => (d._id === updated._id ? { ...d, ...updated } : d)));
      } catch (err) {
        pushToast(`Couldn't save that: ${err.message}`, 'error');
      } finally {
        setConfirmingKey(null);
      }
    },
    [docId, pushToast]
  );

  // ---- delete ----
  const handleDeleteDocument = useCallback(
    async (id) => {
      const target = documents.find((d) => d._id === id);
      const name = target?.filename || 'this document';
      if (typeof window !== 'undefined' && !window.confirm(`Delete "${name}"? This can't be undone.`)) return;
      try {
        await api.deleteDocument(id);
        setDocuments((prev) => prev.filter((d) => d._id !== id));
        if (docId === id) {
          setScreen('ingest');
          setDocId(null);
          setOpenDocData(null);
        }
        refreshSuggestions();
        pushToast(`Deleted "${name}".`, 'success');
      } catch (err) {
        pushToast(`Couldn't delete "${name}": ${err.message}`, 'error');
      }
    },
    [documents, docId, refreshSuggestions, pushToast]
  );

  const handleDeleteAllDocuments = useCallback(async () => {
    if (documents.length === 0) return;
    if (
      typeof window !== 'undefined' &&
      !window.confirm(`Delete all ${documents.length} document${documents.length === 1 ? '' : 's'}? This can't be undone.`)
    ) {
      return;
    }
    setDeletingAll(true);
    const results = await Promise.allSettled(documents.map((d) => api.deleteDocument(d._id)));
    const failedCount = results.filter((r) => r.status === 'rejected').length;
    setDeletingAll(false);
    setScreen('ingest');
    setDocId(null);
    setOpenDocData(null);
    await loadDocuments(); // re-fetch from the server rather than trust local state after a partial failure
    refreshSuggestions();
    if (failedCount === 0) pushToast('All documents deleted.', 'success');
    else pushToast(`Deleted ${results.length - failedCount} of ${results.length} — ${failedCount} failed to delete.`, 'warning');
  }, [documents, loadDocuments, refreshSuggestions, pushToast]);

  // ---- ask ----
  const runAskReal = useCallback(async (question) => {
    const q = (question ?? '').trim();
    if (!q) return;
    setAskDraft(q);
    setAskBusy(true);
    setAskResult(null);
    try {
      const res = await api.askQuestion(q);
      setAskResult(res);
    } catch (err) {
      setAskResult({ refused: true, reason: err.message, answer: null, citations: [], caveats: [] });
    } finally {
      setAskBusy(false);
    }
  }, []);

  const chatSayReal = useCallback(async (text) => {
    setChatMsgs((prev) => [...prev, { role: 'user', text }]);
    setChatDraft('');
    setChatBusy(true);
    try {
      const res = await api.askQuestion(text);
      if (res.refused) {
        setChatMsgs((prev) => [...prev, { role: 'err', title: 'No answer found', text: res.reason || 'Nothing in your documents supports an answer.' }]);
      } else {
        let note = '';
        if (res.caveats?.length) note += ` Note: sources disagree on ${res.caveats.map((c) => c.fieldKey).join(', ')}.`;
        if (res.sensitive) note += ' ⚠ This touches a field marked sensitive — use judgment before sharing.';
        setChatMsgs((prev) => [
          ...prev,
          { role: 'bot', text: res.answer + note, cites: (res.citations || []).map((c) => [c.documentId, c.fieldKey, `${c.filename} · ${c.label || c.fieldKey}`]) },
        ]);
      }
    } catch (err) {
      setChatMsgs((prev) => [...prev, { role: 'err', title: 'Something went wrong', text: err.message }]);
    } finally {
      setChatBusy(false);
    }
  }, []);

  // ---- scenarios (States panel) ----
  const setScenario = useCallback(
    (id) => {
      // Always sync the demo engine's own internal state too, even for a
      // "real" id — cheap, and keeps it from showing stale content from a
      // previous demo scenario if the user switches back to one later.
      const demoRunner = demo.states.scenarios.find((s) => s.id === id);
      demoRunner?.run();

      setScen(id);
      setStatesOpen(false);
      setActive(null);
      setAskResult(null);
      const targetScreen = SCENARIOS.find((s) => s.id === id)?.screen || 'ingest';
      setScreen(targetScreen);

      if (id === 'upload' || id === 'reject') {
        const maxBytes = health.maxFileBytes || 4 * 1024 * 1024;
        const big = 'x'.repeat(maxBytes + 2048);
        runUpload('oversized-test-file.txt', () => api.uploadRawText('oversized-test-file.txt', big));
        if (id === 'reject') {
          const fakeDocx = new File([new Uint8Array([1, 2, 3, 4])], 'resume.docx', {
            type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          });
          runUpload('resume.docx', () => api.uploadDocument(fakeDocx));
        }
      } else if (id === 'blank') {
        const file = base64ToFile(BLANK_PNG_BASE64, 'blank-scan-demo.png', 'image/png');
        runUpload(file.name, () => api.uploadDocument(file)).then((created) => {
          if (created) openDoc(created._id);
        });
      } else if (id === 'nocite') {
        runAskReal('What color is the sky on the planet Neptune?');
      }
      // 'ok' and '404' need no extra action beyond the screen switch above.
    },
    [demo, health.maxFileBytes, runUpload, runAskReal, openDoc]
  );

  // ---- derived view models (real mode) ----
  const demoMode = DEMO_SCENARIO_IDS.has(scen);

  const queueItems = documents.map((d) => {
    // A long document that's mid-read: report where it actually is, not a
    // decorative animation. `unit` tells us whether that's pages or parts.
    if (d.status === 'processing' && d.extraction?.totalChunks > 1) {
      const { completedChunks = 0, totalChunks = 1, unit } = d.extraction;
      const noun = unit === 'page' ? 'page group' : 'part';
      // A document can be left mid-read — a closed laptop, a dropped
      // connection, a tab shut between chunks. The parts already read are
      // saved, so this needs to be a document you can pick back up, not one
      // stranded on a spinner forever.
      const stranded = !resumingIds.includes(d._id);
      return {
        id: d._id, name: d.filename, kind: 'Reading…', icon: iconForDocType(d.docType), clickable: true,
        sub: d.summary || 'Reading this document in parts — everything read so far is already saved.',
        status: 'pending',
        pct: Math.round((completedChunks / totalChunks) * 100),
        stage: `${noun} ${completedChunks} of ${totalChunks}`,
        actions: stranded
          ? [{ label: 'Continue reading', cls: 'btn-secondary', run: () => handleContinueReading(d._id) }]
          : [],
      };
    }
    if (d.status === 'error') {
      // Failing part-way through still leaves real, saved results behind, and
      // locking those away behind an un-clickable row is the worst of both
      // worlds — you're told it failed and you can't see what it did get.
      const partial = (d.fields || []).length > 0;
      return {
        id: d._id, name: d.filename, kind: 'Stopped early', icon: 'ph ph-file-x', clickable: partial,
        sub: d.errorMessage || 'Extraction failed for an unknown reason.', status: 'failed',
        actions: [
          ...(partial
            ? [{ label: 'See what we got', cls: 'btn-secondary', run: () => openDoc(d._id) }]
            : []),
          // With partial results banked, "keep reading" must *resume* from
          // where it stopped — retrying from scratch would throw away pages
          // that were already read and paid for.
          partial
            ? { label: 'Keep reading', cls: 'btn-ghost', run: () => handleContinueReading(d._id) }
            : { label: 'Try again', cls: 'btn-secondary', run: () => handleRetryDocument(d._id) },
        ],
      };
    }
    return {
      id: d._id, name: d.filename, kind: prettyDocType(d.docType), icon: iconForDocType(d.docType), clickable: true,
      category: categoryFor(d.docType),
      sub: d.unreadable ? d.unreadableReason || 'Could not be read clearly.' : d.summary || '',
      status: 'done',
      fieldCount: `${(d.fields || []).length} details found`,
      // Skipped pages outrank "looks clear" — telling someone their tenancy
      // agreement looks clear when four of its seven pages were never read is
      // the single most misleading thing this row could say.
      flagLabel: (() => {
        const skipped = (d.extraction?.unreadableParts || []).length;
        if (skipped) return `${skipped} page${skipped === 1 ? '' : 's'} unread`;
        return (d.fields || []).some((f) => f.needsReview) ? 'worth a check' : 'looks clear';
      })(),
      // A page is skipped for being too slow, and how slow a page is varies
      // between runs — so offering another go is worth something real here,
      // not just a button that repeats the same outcome.
      actions: (d.extraction?.unreadableParts || []).length
        ? [{ label: 'Try the missing pages', cls: 'btn-ghost', run: () => handleRetryDocument(d._id) }]
        : [],
    };
  });
  const pendingItems = inFlight.map((u) => ({
    id: u.tempId, name: u.filename, kind: 'Reading…', icon: 'ph ph-tray-arrow-down', clickable: false,
    sub: 'Reading your document…', status: 'pending', pct: 65, stage: 'reading',
  }));

  const realIngest = {
    addDoc: () => {},
    onFiles: handleFiles,
    onSample: (sample) => runUpload(sample.filename, () => api.uploadRawText(sample.filename, sample.text)),
    dropDisabled: false,
    dropNote: 'PDF, Word, a photo, a scan or plain text — nothing to set up first',
    // "0 ready to use" is a fact nobody needed. Say something only when
    // there is something to say.
    readyLabel: (() => {
      const ready = documents.filter((d) => d.status === 'done').length;
      const reading = inFlight.length + documents.filter((d) => d.status === 'processing').length;
      if (reading) return `${reading} still reading${ready ? ` · ${ready} ready` : ''}`;
      if (!ready) return '';
      return `${ready} ready to use`;
    })(),
    items: [...failedUploads, ...queueItems, ...pendingItems],
    openDoc,
    deleteAll: handleDeleteAllDocuments,
    deletingAll,
    canDeleteAll: documents.length > 0,
  };

  const doc = openDocData;
  const realReview = {
    docLoading,
    notFound: docNotFound,
    noSelection: !docId && !docLoading && !docNotFound,
    docTabs: documents
      .filter((d) => d.status === 'done')
      .slice(0, 8)
      .map((d) => ({ id: d._id, label: d.filename, active: docId === d._id, go: () => openDoc(d._id) })),
    meta: doc ? `${doc.mimeType} · ${(doc.sizeBytes / 1024).toFixed(0)}KB` : '',
    schemaNote: doc ? `${(doc.fields || []).length} details read straight from this document — nothing was assumed or filled in for you` : '',
    newFields: (doc?.newFieldKeys || []).map(humanizeKey),
    readable: !!doc && !doc.unreadable,
    unreadableTitle: 'We couldn’t read this one',
    unreadableText: doc?.unreadableReason || 'The text wasn’t clear enough to read. A sharper photo or scan usually fixes it.',
    deleteDocument: () => docId && handleDeleteDocument(docId),
    docLines: doc ? buildProvenanceLines(doc.documentText, doc.fields).map((line) => ({
      kind: line.kind,
      amt: null,
      segments: line.segments.map((seg) => ({
        text: seg.text,
        fieldId: seg.fieldKey,
        lit: seg.fieldKey ? active === seg.fieldKey || hover === seg.fieldKey : false,
        onClick: seg.fieldKey ? () => setActive((a) => (a === seg.fieldKey ? null : seg.fieldKey)) : undefined,
        onEnter: seg.fieldKey ? () => setHover(seg.fieldKey) : undefined,
        onLeave: seg.fieldKey ? () => setHover(null) : undefined,
      })),
    })) : [],
    fieldRows: (doc?.fields || []).map((f) => {
      const lit = active === f.key || hover === f.key;
      const needs = f.needsReview && !f.confirmed;
      const c = f.confirmed ? 0.99 : f.confidence ?? 0.7;
      return {
        id: f.key, label: f.label || f.key, value: formatFieldValue(f.value), conflict: false, lit, needs,
        checkNote: f.reviewNote || '',
        checkActions: (f.reviewActions?.length ? f.reviewActions : ['Confirm']).map((label) => ({
          label: confirmingKey === f.key ? '…' : label,
          run: () => handleConfirmField(f.key, label),
        })),
        pct: Math.round(c * 100),
        barColor: confidenceColor(c),
        onClick: () => setActive((a) => (a === f.key ? null : f.key)),
        onEnter: () => setHover(f.key),
        onLeave: () => setHover(null),
      };
    }),
    // Pages the reader had to skip. Saying so plainly is the point: a
    // document presented as complete when a page is missing is worse than
    // one that tells you which page to go read yourself.
    truncated: (doc?.extraction?.unreadableParts || []).length > 0,
    truncatedNote: (() => {
      const parts = doc?.extraction?.unreadableParts || [];
      if (!parts.length) return '';
      const list = parts.join(', ');
      return parts.length === 1
        ? `We couldn't read page ${list} — it was too dense or too unclear. Everything from the other pages is here.`
        : `We couldn't read pages ${list} — they were too dense or too unclear. Everything from the other pages is here.`;
    })(),
    notice: doc?.unreadable
      ? null
      : (doc?.fields || []).some((f) => f.sensitive)
      ? {
          icon: 'ph ph-eye-slash',
          title: 'This document contains sensitive information',
          text: `Flagged field(s): ${(doc.fields || []).filter((f) => f.sensitive).map((f) => f.label || f.key).join(', ')}. Consider before sharing externally.`,
          actions: [],
        }
      : null,
    active,
    clearActive: () => { setActive(null); setHover(null); },
    goAsk: () => setScreen('ask'),
    goIngest: () => setScreen('ingest'),
  };

  const askError = askResult && askResult.refused
    ? {
        icon: 'ph ph-shield-check',
        title: 'No answer found',
        text: askResult.reason || 'Nothing in your documents supports an answer to that.',
        actions: [{ label: 'Rephrase', cls: 'btn-ghost', run: () => setAskResult(null) }],
        code: '',
      }
    : null;

  const askAnswer = askResult && !askResult.refused
    ? {
        question: askResult.question,
        text: askResult.answer,
        caveat:
          askResult.caveats?.length
            ? `Sources disagree on ${askResult.caveats.map((c) => c.fieldKey).join(', ')} — ${askResult.caveats
                .map((c) => c.values.map((v) => `${v.filename}: ${JSON.stringify(v.value)}`).join(' vs. '))
                .join('; ')}.`
            : askResult.sensitive
            ? `This answer draws on a field marked sensitive (${askResult.sensitiveFields.join(', ')}) — consider before sharing externally.`
            : null,
        citations: (askResult.citations || []).map((c) => ({ label: `${c.filename} · ${c.label || c.fieldKey}`, go: () => openDoc(c.documentId, c.fieldKey) })),
      }
    : null;

  const realAsk = {
    heading: documents.length ? `Ask anything about your ${documents.length} document${documents.length === 1 ? '' : 's'}.` : 'Add a document first, then ask it anything.',
    draft: askDraft,
    onDraft: setAskDraft,
    submit: () => runAskReal(askDraft),
    busy: askBusy,
    busyStage: 'Looking through your documents',
    busyPct: askBusy ? 60 : 0,
    error: askError,
    answer: askAnswer,
    suggestions: suggestions.map((q, i) => ({
      rank: String(i + 1).padStart(2, '0'), text: q.text, source: (q.docTypes || []).map(prettyDocType).join(', ') || 'your documents', score: Math.max(0.5, 1 - i * 0.08),
      ask: () => runAskReal(q.text),
    })),
    suggestionsHint: 'Based on what we found in your documents',
  };

  const realChat = {
    open: chatOpen, badge: chatBadge,
    toggle: () => { setChatOpen((o) => !o); setChatBadge(false); },
    broken: false,
    status: `${documents.filter((d) => d.status === 'done').length} documents · every answer shows where it came from`,
    busy: chatBusy,
    msgs: chatMsgs.map((m, i) => ({
      key: i, role: m.role, title: m.title || '', text: m.text,
      cites: (m.cites || []).map(([dId, fKey, label]) => ({ label, go: () => openDoc(dId, fKey) })),
      actions: [],
    })),
    chips: suggestions.slice(0, 2).map((q) => ({ label: q.text, run: () => chatSayReal(q.text) })),
    draft: chatDraft,
    onDraft: setChatDraft,
    placeholder: 'Ask about any document…',
    send: () => { if (chatDraft.trim()) chatSayReal(chatDraft.trim()); },
  };

  const realBanner = !bannerDismissed && health.extractionConfigured === false
    ? {
        icon: 'ph ph-key', title: 'AI extraction is not configured.',
        text: 'Set ANTHROPIC_API_KEY on the server to enable real extraction and Ask — uploads will still save, just without structured data.',
        cta: 'Dismiss', action: () => setBannerDismissed(true),
      }
    : null;

  // A real, distinct banner for "we couldn't reach the server at all" —
  // separate from the extraction-not-configured one above, and separate
  // from the demo engine's illustrative offline/stalled banners.
  const loadErrorBanner = loadError
    ? {
        icon: 'ph ph-wifi-slash', title: "Couldn't load your documents.",
        text: loadError, cta: 'Retry', action: loadDocuments,
      }
    : null;

  return {
    loading,
    loadError,
    toasts, dismissToast,
    nav: { go: (s) => setScreen(s), current: screen },
    topBar: demoMode ? demo.topBar : { pct: inFlight.length || deletingAll ? 60 : 0 },
    banner: demoMode ? demo.banner : loadErrorBanner || realBanner,
    ingest: demoMode ? demo.ingest : realIngest,
    review: demoMode ? demo.review : realReview,
    ask: demoMode ? demo.ask : realAsk,
    states: {
      open: statesOpen,
      toggle: () => setStatesOpen((o) => !o),
      current: scen,
      scenarios: SCENARIOS.map((sc) => ({ ...sc, isReal: REAL_SCENARIO_IDS.has(sc.id), run: () => setScenario(sc.id) })),
    },
    chat: demoMode ? demo.chat : realChat,
    session: demoMode ? demo.session : { open: false, dismiss: () => {} },
  };
}
