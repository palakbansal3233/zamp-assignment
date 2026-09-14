# decisions.md

The real calls I made building **Sift**, and why. Organised against the things you said you'd evaluate.

---

## 1. Problem framing

**The brief:** turn unstructured or semi-structured documents into clean, structured, queryable data.

**How I read it.** The hard word in that sentence is *unstructured*. There are two ways to satisfy the brief:

- **Pick one document type** (invoices, say), hard-code a schema for it, and extract against that schema. Reliable, demoable, and — for anyone who's seen a few invoice parsers — unremarkable. It also quietly deletes the actual problem: if you already know the schema, the document was never really unstructured.
- **Accept that you don't know what's coming.** No schema, no template, no document-type list. Infer the shape per document and merge the results into one dataset you can query across.

I took the second, and everything downstream follows from it: a `fields` array of self-describing descriptors rather than typed columns, a text index built by flattening whatever came back, search that's grounded in the field keys actually observed rather than a fixed set.

**What that cost me, deliberately:** no per-type UI (no invoice line-item table, no resume timeline). A domain-specific build would look more finished in a screenshot. I'd rather be judged on the part that's hard.

**Scoped out, on purpose:**

| Left out | Why |
|---|---|
| Auth / multi-user | Orthogonal, well-understood, would have eaten the time this project's actual problem deserved. One user, one corpus. |
| Vector DB / embeddings / RAG retrieval | The corpus is *already structured* — extraction did that work. Grounding answers in extracted fields is more precise than re-embedding text I've already parsed, at this scale. Revisit if "find documents about a similar topic" ever becomes a requirement. |
| Background job queue | See §2 — the person this is for uploads one document that matters and watches it land. Durable queue infra buys them nothing. |
| Cross-document entity resolution | Conflict detection works when two documents use the *same* field key. Recognising that `price_escalator_note` and `price_cap_percentage` describe the same fact is a genuinely different (and much larger) problem. Named, not hidden — see §9. |
| `.doc`, video, audio, archives | Outside what the persona actually holds. `.doc` gets a specific "save as .docx or PDF" message rather than a generic rejection, because it's the likeliest near-miss. |

---

## 2. Product thinking — who this is for

**Not** an enterprise document pipeline. **Not** a finance team processing 500 invoices a day. Those people have a schema and a vendor.

This is for **the person holding a document that matters, which they can't fully read.**

Concretely, the same person in three different weeks:

- A **12-page rental agreement** they're about to sign. They need to know the deposit, the notice period, and whether they can sublet — buried in clause 8 of something written to be skimmed past.
- A **prescription in a doctor's handwriting** they need to relay to a friend picking up the medicines. They need the drug and the dose, they need to know which words the machine wasn't sure about, and they'd rather not paste someone's health details into a group chat unwarned.
- An **invoice** they need to check before paying.

Those three documents share *nothing* structurally. That's the point — and it's why the schema-agnostic framing in §1 is the right product call rather than a cop-out. A tool that only works once you've told it what kind of document you have is useless to someone holding whatever arrived in the post.

What that person actually needs, in priority order:

1. **The facts pulled out** without being asked to define what "the facts" are.
2. **A way to check the machine's work** before acting on it — because they're about to sign, pay, or administer something.
3. **Honesty about uncertainty.** Handwriting is genuinely ambiguous. "I read this as 500mg but it could be 50mg" is useful; a confident wrong number is harmful.
4. **A warning before they forward it.** Prescriptions and agreements carry details that shouldn't casually leave your hands.

Every feature below traces back to one of those four. Anything that didn't, I didn't build.

**The volume assumption is load-bearing.** Low-frequency, high-stakes — one document at a time, watched. That single fact is why synchronous processing is *correct* here rather than a compromise, and why I spent the infrastructure budget on making long documents work instead of on a queue.

---

## 3. UX decisions

**Click a field, see where it came from.** The Review screen highlights the exact span of source text behind each extracted value. This is the answer to need #2 — she can verify the deposit amount against the actual clause before signing. It's a real substring match against the model's own transcription; a quote that doesn't actually appear simply doesn't highlight, and nothing breaks.

**Uncertainty is a first-class field property, not a footnote.** Each field carries a confidence, and an ambiguous one carries a note *and the concrete readings to choose between* — on the sample agreement, which states the deposit as 2,175.00 in clause 4 and 2,750.00 in Schedule A, that's "these figures conflict" plus a button for each. Confirming records which reading a human picked. It deliberately does **not** parse a new value out of the button label: recording *what the person chose* is honest, guessing what that implies numerically is not.

**A review flag without a reason is dropped.** The model sometimes marks a field uncertain and says nothing about why. Surfacing that is a warning badge and a Confirm button attached to a value the person now trusts less, for reasons nobody will ever tell them. The uncertainty isn't lost — it's still the confidence score — but the flagged set stays meaningful: everything flagged has a real reason and real options.

**Two sample documents, one click, in the empty state.** Nobody should have to go find a rental agreement to discover whether this works. The samples are chosen to exercise the hard parts rather than to look tidy: the agreement contradicts itself about the deposit, and the prescription (`TDS x 7/7`, `2 puffs PRN, max QDS`) carries an NHS number and a date of birth — so the decoding, the review flow, and the sensitivity warning all fire on first contact.

**Ask cites, or it refuses.** Answers name the exact documents and fields they're grounded in. If nothing supports an answer, it says so rather than producing something plausible. For someone asking "what's my notice period" before serving notice, a wrong answer is worse than no answer.

**Sensitive fields warn before they travel.** Extraction flags what shouldn't be casually shared; Review shows a standing notice, and Ask cautions when an answer draws on one. Directly serving need #4 — the prescription-to-a-friend case.

**Progress that means something.** A long document reports "page group 3 of 4", not a decorative animation — because it's genuinely reading in parts and each one is genuinely saved.

**Honest empty and failure states.** "No document selected" is a different message from "this document was unreadable", which is different again from "we couldn't reach the server", which is different from a real 404 for a document that was deleted. These all rendered identically at one point; they don't now. Actions that used to fail silently now say so.

**The States panel is labelled.** The design includes a 15-scenario switcher. Six trigger genuine backend behaviour (a real oversized upload, a real blank scan, a real refusal). The rest need infrastructure I chose not to build (auth, billing, offline sync) and are tagged **(demo)** in the UI itself. Showing an offline banner I can't actually produce, without saying so, would be a lie told in pixels.

---

## 4. Code quality

- **One Express app, two runtimes.** `server/src/app.js` is mounted under `/api` locally and wrapped by `serverless-http` for Netlify. One set of routes, no drift between what I test and what deploys.
- **Never trust model output — verify it.** The single most repeated pattern in this codebase. LLM-proposed search filters are re-validated against a field/operator allowlist before touching Mongo (`sanitizeFilters`). LLM-proposed citations are re-checked against real stored documents before being shown (`verifyCitations`). LLM-produced quotes are only trusted as far as `indexOf` confirms them. There is no `JSON.parse()` on model prose anywhere — every structured response comes back through forced tool-use.
- **Derived data is rebuilt at its single write site.** `fieldIndex` (the flat shadow of `fields` that keeps search filtering simple) and `searchableText` are recomputed together, everywhere `fields` changes, with no exceptions. A denormalised field that can drift is worse than no denormalised field.
- **One deliberate tradeoff worth naming:** filtering queries `fieldIndex.<key>` rather than `$elemMatch` against the `fields` array. `$elemMatch` is more "correct", but it would push real complexity into `sanitizeFilters` — the one function most worth keeping small and auditable — to support filtering on field *metadata* that search never used.

---

## 5. Tests

**93 tests, and they're pointed at the things that would actually hurt.**

- The query sanitizer, against injection attempts (`$where`, operator objects smuggled as values, prototype-ish paths).
- Citation verification: a hallucinated document id, a field key that doesn't exist, a malformed citation — each dropped; and the rule that **zero surviving citations forces a refusal** rather than an ungrounded answer.
- Chunk merging: that a confident later page **cannot** clear an earlier page's needs-review or sensitivity flag, that a signature page can't relabel a whole agreement, that "unreadable" only survives if nothing anywhere was read.
- Resumability: one request reads one chunk under a zero budget, resume continues rather than restarting, a mid-document failure keeps everything already read.
- Byte-for-byte file serving, upload validation, the full `/ask` flow.

**Three bugs found because of testing, not despite it** — worth listing, because how a bug was found says more than a suite that was green from the start:

1. A `$text` query raced Mongoose's background index build on a cold database. Found by a manual smoke test against a *fresh* database; the mocked suite pre-connected and never hit it. Fixed in `db/connect.js`; regression test added.
2. `.lean()` skips Mongoose's Buffer casting, so file downloads silently served base64 *strings* instead of bytes. The original test asserted a status code and content-type — both correct while the body was wrong. Now asserts the bytes.
3. Test pollution: `jest.clearAllMocks()` doesn't drain `mockResolvedValueOnce` queues, and the chunking tests deliberately leave chunks unconsumed — leftovers spilled into the next test and failed it for unrelated reasons. Switched to `resetAllMocks`; the suite now passes under `--randomize`.

Plus a **golden eval** (`npm run eval`) — 16 questions over 5 seeded documents, scoring **retrieval accuracy separately from generation accuracy**, because a prompt tweak can't fix a retrieval miss and conflating the numbers hides which one broke. Last run: 100% / 100%. Its first run reported 94% — which turned out to be a bug in my own scoring script, not the app.

---

## 6. Documentation

This file, and a README aimed at someone who has never seen the project: what it does, how to run it, how to run the tests and the eval. Code comments are reserved for explaining *why* — the non-obvious tradeoff, the bug that motivated a line — rather than restating what the code says.

---

## 7. Setup experience

```bash
npm install && cp server/.env.example server/.env   # fill in 2 values
npm run dev
```

One install, one command, both servers. `server/.env.example` documents every variable inline, including where to get each one.

**It degrades rather than refusing to start.** No `ANTHROPIC_API_KEY`? The app runs, uploads still save, extraction reports a clear per-document reason, search falls back to keyword-only, and a banner tells you why. Nothing about diagnosing a half-configured setup is left to guesswork.

---

## 8. Velocity

Working, deployed, and verified end-to-end: ingestion for PDF / DOCX / images / text, schema-agnostic extraction with provenance, confidence and sensitivity flagging, a review flow with human confirmation, keyword + LLM-filtered search, a cited-or-refusing Ask endpoint with cross-document conflict detection, chunked resumable reading of long documents, 93 tests, a golden eval harness, and a three-screen UI built from a design system — running on one Netlify deploy with MongoDB Atlas.

Two production bugs found and fixed against the live deployment, not just locally: an Atlas IP-allowlist issue, and a `basePath` mismatch where Netlify's rewrite passes the function the original client path rather than the internal one — which every prior test had "verified" against my own wrong assumption instead of the platform's real behaviour.

---

## 9. Above and beyond — the hard part I went at

**Long documents, which is where this quietly falls over.**

The rental agreement is the whole reason this product exists for its user, and it is exactly the document a single request/response extraction can't handle. A 7-page PDF timed out in production. The easy fix is to raise a number — which fails again at 20 pages, and pretends the platform's patience is the user's problem.

So a document is no longer one model call. It's a sequence of bounded chunks: PDFs are split into real, smaller PDFs by page range (not described — actually rebuilt), each chunk is its own model call, and **results are persisted after every single chunk**. A request reads what fits in its budget, returns what it has, and leaves `nextChunkIndex` behind; the client resumes until done. A timeout, a crash, or a closed laptop costs you one chunk, not the document.

Three things fall out of that, and each one is a deliberate property rather than a happy accident:

- **Partial results are real results.** A document that fails on page 9 keeps pages 1–8, tells you where it stopped, and resumes from there.
- **Merging is safety-preserving.** A later, more confident chunk can overwrite a value — but it can **never** clear an earlier chunk's needs-review or sensitivity flag. A warning that vanishes because page 10 mentioned the same field more confidently is exactly the silent downgrade this product can't afford.
- **The progress bar became true.** It was decorative in the design. It now reports real chunks completed.

*Verified against production, not asserted:* a 10-page tenancy agreement → 5 chunks, 2 in the upload request (returning at 17.8s with those two already saved and readable) and 3 on one resume, complete in 34.8s. 24 fields spanning every page including the signature block, **zero** unverifiable quotes, bank details and the deposit reference flagged sensitive, and Ask correctly answering a question that required combining clause 5 with clause 9.

**And the part that only production could teach me.** The first deployed attempt came back `504 Inactivity Timeout` from the edge. The bug was in how I'd defined "budget": it decided whether to *start* another chunk, so a chunk beginning at 29s could run the request past 45s — bounded at the wrong end. The fix is that the controller now refuses to start a chunk unless the slowest one so far would still fit, which bounds total elapsed time as intended; the budget dropped to 18s and chunks to 2 pages so one always fits comfortably. And because a request can die *after* the server has already saved chunks — the work survives, only the response is lost — the client now re-reads the document on failure and carries on if it advanced, rather than treating a dropped response as a dead document. Three changes, all written from one real HTTP status code rather than from imagination.

**Three smaller ones in the same spirit:**

- **Provenance you can check.** Extraction returns a verbatim transcription plus a source quote per field; the UI matches those quotes back into the text. The model is never trusted about where something came from — only `indexOf` is.
- **Grounding that's enforced, not requested.** Asking the model to cite its sources is easy. Verifying every citation against the database and *forcing a refusal when none survive* is the part that makes the answer trustworthy.
- **Retrieval and generation scored separately** in the eval, so a regression tells you which half broke.

**What I'd do next, honestly:** cross-document entity resolution (so conflicts are caught even when documents name the same fact differently), and per-page quote anchoring for tabular data (today a line-items block gets one quote for the region, not one per row).
