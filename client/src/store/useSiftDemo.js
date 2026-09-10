import { useCallback, useEffect, useRef, useState } from 'react';
import { DOCS, LAB_DOC, PENDING, GREETING, SUGGESTIONS, SCENARIOS, REJECTS, BANNERS, ASK_ERRORS } from '../mock/data';

// This hook is the demo/showcase engine behind the States panel — it is the
// direct port of the Claude Design prototype's `Component` class (state +
// renderVals()). It intentionally stays separate from the real app engine
// (Phase B, wired to the actual API) so the two don't get tangled: this one
// exists to make the *design* — every screen, every edge case — inspectable
// and demoable, independent of what the real backend can produce today.
// See decisions.md for which scenarios here are illustrative-only.

const initialState = {
  screen: 'ingest', docId: 'inv', active: null, hover: null, scen: 'ok',
  progress: { lab: 0.34, thread: 0.62 }, confirmed: {},
  draft: '', answer: null, askErr: null, askBusy: false, askPct: 0,
  statesOpen: false, sessionOpen: false,
  chatOpen: false, chatDraft: '', chatBusy: false, chatBadge: true,
  chatMsgs: [GREETING]
};

function confidenceColor(conf) {
  if (conf >= 0.9) return 'var(--color-accent)';
  if (conf >= 0.8) return 'var(--color-accent-600)';
  return 'var(--color-neutral-500)';
}

function answerFor(text) {
  const t = (text || '').trim().toLowerCase();
  if (!t) return null;
  const words = t.split(/\W+/).filter((w) => w.length > 3);
  if (!words.length) return null;
  return (
    SUGGESTIONS.find(
      (q) => words.filter((w) => q.text.toLowerCase().includes(w)).length >= Math.max(1, Math.ceil(words.length * 0.4))
    ) || null
  );
}

export function useSiftDemo() {
  const [s, setS] = useState(initialState);
  const patch = useCallback((partial) => setS((prev) => ({ ...prev, ...(typeof partial === 'function' ? partial(prev) : partial) })), []);
  const timers = useRef({});

  // aggregate ingest progress ticks while docs are "reading"
  useEffect(() => {
    const id = setInterval(() => {
      setS((prev) => {
        if (prev.scen === 'stalled' || prev.scen === 'offline') return prev;
        return {
          ...prev,
          progress: {
            lab: Math.min(0.97, prev.progress.lab + 0.03),
            thread: Math.min(0.97, prev.progress.thread + 0.02)
          }
        };
      });
    }, 900);
    return () => clearInterval(id);
  }, []);

  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), []);

  const doc = s.docId === 'lab' ? LAB_DOC : DOCS.find((d) => d.id === s.docId) || DOCS[0];

  const go = useCallback((screen) => patch({ screen }), [patch]);
  const openDoc = useCallback((id, field) => patch({ screen: 'review', docId: id, active: field || null }), [patch]);

  const setScenario = useCallback(
    (id) => {
      const sc = SCENARIOS.find((x) => x.id === id);
      patch({
        scen: id, screen: sc.screen, statesOpen: false, sessionOpen: id === 'session',
        active: null, answer: null, askBusy: false, askErr: null, draft: '',
        docId: id === 'blank' ? 'lab' : id === 'partial' || id === 'conflict' ? 'msa' : 'inv',
        chatDraft: '', chatBusy: false,
        chatMsgs: id === 'model'
          ? [GREETING,
             { role: 'user', text: 'Summarise every renewal date we have.' },
             { role: 'err', title: 'The model did not respond', text: 'Timed out after 30s on a 14-page context. Your question is saved — retrying does not re-read the documents.', actions: [['Retry', 'btn-secondary'], ['Narrow to 1 doc', 'btn-ghost']] }]
          : id === 'offline'
            ? [GREETING, { role: 'err', title: 'No connection', text: 'Six earlier answers are readable from cache. New questions are queued until you are back online.', actions: [['Retry', 'btn-secondary']] }]
            : id === 'quota'
              ? [GREETING, { role: 'bot', text: 'Reading is paused for the month, so I answer only from the 214 fields already extracted. Two documents have none yet.' }]
              : [GREETING]
      });
    },
    [patch]
  );

  const runAsk = useCallback(
    (text) => {
      const scen = s.scen;
      patch({ draft: text, answer: null, askErr: null, askBusy: true, askPct: 8 });
      clearTimeout(timers.current.t1);
      clearTimeout(timers.current.t2);
      timers.current.t1 = setTimeout(() => patch({ askPct: 64 }), 350);
      timers.current.t2 = setTimeout(() => {
        if (scen === 'model') return patch({ askBusy: false, askErr: 'timeout' });
        if (scen === 'offline') return patch({ askBusy: false, askErr: 'offline' });
        if (scen === 'ambiguous') return patch({ askBusy: false, askErr: 'ambiguous' });
        if (scen === 'nocite') return patch({ askBusy: false, askErr: 'nocite' });
        const hit = answerFor(text);
        patch({ askBusy: false, answer: hit, askErr: hit ? null : 'nofield', askPct: 100 });
      }, 900);
    },
    [s.scen, patch]
  );

  const chatSay = useCallback(
    (text) => {
      const scen = s.scen;
      const push = (m) => setS((prev) => ({ ...prev, chatMsgs: prev.chatMsgs.concat([m]) }));
      push({ role: 'user', text });
      patch({ chatDraft: '', chatBusy: true });
      clearTimeout(timers.current.t1);
      timers.current.t1 = setTimeout(() => {
        patch({ chatBusy: false });
        if (scen === 'offline') return push({ role: 'err', title: 'No connection', text: 'Your question is queued. Cached answers for the 12 read documents still work — this one needs the model.', actions: [['Retry', 'btn-secondary']] });
        if (scen === 'model') return push({ role: 'err', title: 'Rate limited (429)', text: 'The model is at capacity for your workspace. Queued — retrying in about 12 seconds. Nothing is lost.', actions: [['Retry now', 'btn-secondary'], ['Cancel', 'btn-ghost']] });
        if (scen === 'quota') return push({ role: 'err', title: 'Quota exhausted', text: 'Reading is paused for the month, so I can only answer from fields already extracted — 2 documents have none yet.', actions: [['Add pages', 'btn-secondary']] });
        const hit = answerFor(text);
        if (!hit) return push({ role: 'err', title: 'No field covers that', text: 'The documents may still say it — extraction never pulled it out. I can re-read the corpus for this one field.', actions: [['Extract it', 'btn-secondary']] });
        push({ role: 'bot', text: hit.answer, cites: hit.cites });
      }, 1100);
    },
    [s.scen, patch]
  );

  const setHover = useCallback((h) => patch({ hover: h }), [patch]);
  const toggleActive = useCallback((fid) => setS((prev) => ({ ...prev, active: prev.active === fid ? null : fid })), []);

  // ── derive the whole view model (mirrors the prototype's renderVals()) ──
  const scen = s.scen;
  const blank = scen === 'blank';
  const partial = scen === 'partial';
  const denied = scen === 'denied';
  const anyBusy = !(scen === 'stalled' || scen === 'quota');
  const agg = Math.round(((s.progress.lab + s.progress.thread) / 2) * 100);

  const queue = DOCS.map((d) => ({
    id: d.id, name: d.name, kind: d.kind, icon: d.icon, clickable: true,
    sub: d.meta.replace(/ · read in .*/, ''),
    fieldCount: (d.fields.length + (d.id === 'inv' ? 3 : 12)) + ' fields extracted',
    flagLabel: d.fields.some((f) => f.check && !s.confirmed[f.id]) ? '1 field to confirm' : 'clean',
    status: 'done'
  }));

  const pending = PENDING.map((p) => {
    const pct = Math.round((s.progress[p.id] || 0) * 100);
    const stalled = scen === 'stalled';
    const paused = scen === 'quota' || scen === 'offline';
    return {
      id: p.id, name: p.name, kind: p.kind, icon: p.icon, clickable: false,
      sub: stalled ? 'Queued 14 minutes ago — no worker has claimed it' : paused ? 'Waiting — reading is paused' : p.sub,
      status: 'pending', pct, stalled, paused,
      stage: stalled ? `stalled at ${pct}%` : paused ? `paused at ${pct}%` : `${pct}% · inferring fields`,
      actions: stalled ? [{ label: 'Requeue', cls: 'btn-secondary', run: () => setScenario('ok') }, { label: 'View worker log', cls: 'btn-ghost', run: () => {} }] : []
    };
  });

  const failed = (REJECTS[scen] || []).map((r, i) => ({
    id: `reject-${i}`, name: r.name, kind: r.kind, icon: r.icon, clickable: false,
    sub: r.sub, status: 'failed',
    actions: r.actions.map(([l, c]) => ({ label: l, cls: c, run: () => setScenario('ok') }))
  }));

  let fields = doc.fields.slice();
  if (partial) fields = fields.slice(0, 4);
  if (blank) fields = [];
  if (scen === 'conflict') {
    fields = fields.map((f) =>
      f.id === 'price_escalator'
        ? { id: f.id, label: f.label, value: 'CPI + 2%  ·  invoice says 4% flat', conf: 0.48, conflict: true, check: 'Invoice 2291 and MSA §5.1 disagree. Pick the record of truth — the dataset stores one value.', actions: ['Trust contract', 'Trust invoice', 'Keep both'] }
        : f
    );
  }

  const fieldRows = fields.map((f) => {
    const lit = s.active === f.id || s.hover === f.id;
    const needs = !!f.check && !s.confirmed[f.id];
    const c = s.confirmed[f.id] ? 0.99 : f.conf;
    return {
      id: f.id, label: f.label, value: f.value, conflict: !!f.conflict, lit, needs,
      checkNote: f.check || '',
      checkActions: (f.actions || ['Confirm']).map((l) => ({
        label: l, run: () => setS((prev) => ({ ...prev, confirmed: { ...prev.confirmed, [f.id]: true } }))
      })),
      pct: Math.round(c * 100),
      barColor: confidenceColor(c),
      pctColor: c >= 0.9 ? 'var(--color-accent-300)' : 'var(--color-neutral-500)',
      onClick: () => toggleActive(f.id),
      onEnter: () => setHover(f.id),
      onLeave: () => setHover(null)
    };
  });

  const docLines = doc.lines.map((l) => ({
    kind: l.k,
    amt: l.amt || null,
    segments: l.segs.map(([text, fid]) => ({
      text, fieldId: fid, lit: fid ? s.active === fid || s.hover === fid : false,
      onClick: fid ? () => toggleActive(fid) : undefined,
      onEnter: fid ? () => setHover(fid) : undefined,
      onLeave: fid ? () => setHover(null) : undefined
    }))
  }));

  const notices = {
    partial: { icon: 'ph ph-warning-octagon', title: 'Extraction stopped at page 9 of 14', text: 'The model returned malformed JSON on page 9 and the run halted. 4 of 19 fields were captured; the rest are untouched, not wrong.', actions: [{ label: 'Resume from page 9', cls: 'btn-primary', run: () => setScenario('ok') }, { label: 'See raw output', cls: 'btn-ghost', run: () => {} }] },
    conflict: { icon: 'ph ph-git-diff', title: 'Two documents disagree on price_escalator', text: 'A value only enters the dataset once. Until you pick, queries that touch it return both readings with a caveat.', actions: [{ label: 'Compare side by side', cls: 'btn-secondary', run: () => {} }, { label: 'Ask about it', cls: 'btn-ghost', run: () => go('ask') }] },
    denied: { icon: 'ph ph-eye-slash', title: 'Source hidden', text: 'These fields came from a document you cannot open, so provenance highlighting is unavailable. The values were extracted before the folder was restricted.', actions: [{ label: 'Request access', cls: 'btn-secondary', run: () => {} }] }
  };
  const notice = notices[scen] || null;

  const suggestions = SUGGESTIONS.slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map((q, i) => ({ rank: String(i + 1).padStart(2, '0'), text: q.text, source: q.source, score: q.score, ask: () => runAsk(q.text) }));

  const ae = s.askErr ? ASK_ERRORS[s.askErr] : null;
  const askErrActions = {
    timeout: [{ label: 'Retry', cls: 'btn-primary', run: () => patch({ askErr: 'rate' }) }, { label: 'Ask one document instead', cls: 'btn-ghost', run: () => openDoc('msa') }],
    rate: [{ label: 'Keep waiting', cls: 'btn-secondary', run: () => setScenario('ok') }, { label: 'Cancel', cls: 'btn-ghost', run: () => patch({ askErr: null }) }],
    nocite: [{ label: 'Extract this field from all 12 documents', cls: 'btn-primary', run: () => setScenario('ok') }, { label: 'Rephrase', cls: 'btn-ghost', run: () => patch({ askErr: null }) }],
    nofield: [{ label: 'Extract it from all 12 documents', cls: 'btn-primary', run: () => patch({ askErr: null, screen: 'ingest' }) }, { label: 'Clear', cls: 'btn-ghost', run: () => patch({ askErr: null }) }],
    ambiguous: [{ label: 'Meridian Health Group (billed)', cls: 'btn-secondary', run: () => runAsk('Which VAT ID does Northwind bill under?') }, { label: 'Meridian Clinic — Sandyford (delivery)', cls: 'btn-secondary', run: () => runAsk('Where is delivery actually going, versus who is billed?') }],
    offline: [{ label: 'Retry', cls: 'btn-secondary', run: () => setScenario('ok') }, { label: 'Show cached answers', cls: 'btn-ghost', run: () => patch({ askErr: null }) }]
  };

  const chatMsgs = s.chatMsgs.map((m, i) => ({
    key: i, role: m.role, title: m.title || '', text: m.text,
    cites: (m.cites || []).map(([d2, f2, label]) => ({ label, go: () => openDoc(d2, f2) })),
    actions: (m.actions || []).map(([l, c]) => ({
      label: l, cls: c,
      run: () => {
        if (l === 'Retry' || l === 'Retry now') { setScenario('ok'); chatSay('Summarise every renewal date we have.'); }
        else patch({ scen: 'ok' });
      }
    }))
  }));

  const chatBroken = scen === 'offline' || scen === 'model' || scen === 'quota';
  const bannerKey = BANNERS[scen] ? scen : null;
  const banner = bannerKey ? BANNERS[bannerKey] : null;

  return {
    state: s, patch, doc,
    nav: { go, current: s.screen },
    topBar: { pct: anyBusy ? agg : 0 },
    banner: banner ? { ...banner, action: () => setScenario('ok') } : null,
    ingest: {
      addDoc: () => patch({ screen: 'review', docId: 'msa' }),
      dropDisabled: scen === 'offline' || scen === 'quota',
      dropNote: scen === 'offline'
        ? 'Offline — dropped files are held on this device and upload when you reconnect'
        : scen === 'quota' ? 'Reading paused until your page allowance resets on 1 October'
        : 'No schema needed — fields are inferred per document and merged into the dataset',
      readyLabel: scen === 'stalled' ? '2 ready · 2 stalled' : scen === 'quota' ? '2 ready · 2 paused' : `${DOCS.length} ready · ${PENDING.length} reading`,
      items: [...failed, ...queue, ...pending],
      openDoc
    },
    review: {
      docTabs: (blank ? DOCS.concat([LAB_DOC]) : DOCS).map((d) => ({ id: d.id, label: d.label, active: s.docId === d.id, go: () => patch({ docId: d.id, active: null }) })),
      meta: blank ? 'TIFF · 2 pages · 118 dpi · OCR returned 4 characters' : denied ? 'Source restricted · fields cached 4 Sept' : doc.meta,
      schemaNote: blank ? 'Nothing to infer from yet' : partial ? '4 of 19 fields captured before the run halted' : doc.schemaNote,
      newFields: (blank ? [] : doc.newFields),
      readable: !blank && !denied,
      unreadableTitle: denied ? 'You cannot open this document' : 'No text could be recovered',
      unreadableText: denied
        ? 'The file lives in a restricted folder. Extracted values are still shown on the right, but there is nothing to highlight them against.'
        : 'The scan is 118 dpi with heavy skew; OCR returned 4 characters across 2 pages. Re-scan at 300 dpi or key the values in by hand — we will not guess at an unreadable page.',
      docLines, fieldRows,
      truncated: partial,
      truncatedNote: 'Pages 9–14 were not parsed. The document text ends here because the run halted, not because the file does.',
      notice,
      clearActive: () => patch({ active: null, hover: null }),
      goAsk: () => go('ask')
    },
    ask: {
      heading: 'Twelve documents, no shared schema. Here is what they can answer.',
      draft: s.draft,
      onDraft: (v) => patch({ draft: v }),
      submit: () => runAsk(s.draft),
      busy: s.askBusy, busyStage: 'Matching your question against 214 extracted fields', busyPct: s.askPct,
      error: ae ? { ...ae, actions: askErrActions[s.askErr] || [] } : null,
      answer: s.answer
        ? {
            question: s.answer.text, text: s.answer.answer,
            caveat: scen === 'conflict' ? 'Two documents disagree on price_escalator, so this answer holds only if the contract is the record of truth.' : null,
            citations: s.answer.cites.map(([docId, field, label]) => ({ label, go: () => openDoc(docId, field) }))
          }
        : null,
      suggestions
    },
    states: {
      open: s.statesOpen,
      toggle: () => patch({ statesOpen: !s.statesOpen }),
      current: scen,
      scenarios: SCENARIOS.map((sc) => ({ ...sc, run: () => setScenario(sc.id) }))
    },
    chat: {
      open: s.chatOpen, badge: s.chatBadge,
      toggle: () => patch({ chatOpen: !s.chatOpen, chatBadge: false }),
      broken: chatBroken,
      status: scen === 'offline' ? 'Offline — cached answers only' : scen === 'model' ? 'Model at capacity — retrying' : scen === 'quota' ? 'Reading paused · 12 of 14 documents' : '12 documents · answers carry citations',
      busy: s.chatBusy,
      msgs: chatMsgs,
      chips: SUGGESTIONS.slice(0, 2).map((q) => ({ label: q.text, run: () => chatSay(q.text) })),
      draft: s.chatDraft,
      onDraft: (v) => patch({ chatDraft: v }),
      placeholder: scen === 'offline' ? 'Offline — questions are queued' : 'Ask about any document…',
      send: () => { if (s.chatDraft.trim()) chatSay(s.chatDraft.trim()); }
    },
    session: { open: s.sessionOpen, dismiss: () => patch({ sessionOpen: false }) }
  };
}
