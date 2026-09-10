# decisions.md

A running log of the real calls made building this, in roughly the order they came up. Written for whoever reads this after the fact — including me in six months.

---

## 1. Which problem, and what "messy documents" means here

**Decision:** Picked "Turn messy documents into structured, queryable data," scoped to *generic, unknown-ahead-of-time* documents — not a fixed domain like invoices-only. A document can be a clean digital PDF, a phone photo of a receipt, a scanned form, a scribbled note, a resume, or something I haven't thought of. The system doesn't get told what kind of document is coming.

**Alternatives considered:** Scoping to one domain (invoices, or resumes) would have let me build a tighter, more polished single-purpose tool with a fixed schema and nicer domain-specific UI (line-item tables, resume timeline view, etc.).

**Reasoning:** The domain-specific version is the "safe" build — it's impressive if you've seen a hundred invoice-parsers, less so if you haven't, and it dodges the actual hard part of the problem statement ("messy *or* semi-structured," genuinely unknown structure). The generic version forces the real design problem: a schema you don't know in advance, storage that doesn't assume a shape, and a search experience that has to work across heterogeneous data. That's the part I wanted to be judged on.

**What this costs:** No domain-specific UI (no invoice line-item table, no resume timeline). The tradeoff is explicit and deliberate — see §9.

---

## 2. Extraction approach: LLM with forced structured output, not regex/rules

**Decision:** Every document — text, image, or PDF — goes to Claude (Anthropic API) through a single tool call (`record_extraction`) with a JSON schema, using `tool_choice: {type: "tool", name: "record_extraction"}` to *force* the response through that schema. There is no `JSON.parse()` anywhere in this codebase parsing freeform model text, and no regex stripping markdown fences.

**Alternatives considered:**
- **Rule-based/regex parsing per document type.** Free, deterministic, no API dependency. Rejected because it's the opposite of what "messy, unknown-in-advance documents" needs — a regex for invoices tells you nothing about a handwritten note, and you're back to needing to know the domain ahead of time (see §1).
- **Prompting the model to "return JSON" in prose and parsing the response text.** This is the common lazy version of LLM extraction, and it's genuinely bad in practice — models wrap JSON in markdown fences, add a sentence before it, sometimes emit near-JSON. Forcing a tool call sidesteps that whole failure class structurally, not with a parser.

**Reasoning:** This is the actual hard sub-problem in this project, and I wanted to solve it properly rather than route around it. The schema itself also carries an honesty contract: `unreadable` / `unreadable_reason` gives the model an explicit way to say "I can't read this" instead of being implicitly pressured to invent plausible-looking fields, and `low_confidence_fields` lets it surface uncertainty (illegible handwriting, ambiguous formatting) instead of presenting every field with false uniform confidence. See `server/src/services/extraction.js`.

**What I cut:** No self-consistency checks (e.g. running extraction twice and diffing). One model call per document, trusted as-is. For a 1-shot assignment, running each document twice to catch model flakiness was a cost/complexity I didn't think was worth it — the honesty fields do most of the useful work cheaply.

---

## 3. PDFs: Claude's native PDF support, not a rasterization pipeline

**Decision:** PDFs are sent to Claude directly as a `document` content block (base64), the same call used for images. No `pdf-parse`, no PDF-to-image conversion, no OCR library.

**Alternatives considered:** My first plan (before checking what the API actually supports) was: use `pdf-parse` to pull the text layer, and if the PDF has no text layer (i.e. it's a scan), treat scanned PDFs as unsupported and tell the user to export a photo instead. I'd essentially decided to *cut* scanned-PDF support because rasterizing PDF pages inside a Netlify Function (no system `poppler`/`ghostscript` binary available) is a real, ugly infra problem.

**Reasoning I changed course on:** Claude's Messages API accepts PDFs as a native document input and reads each page directly (including scanned/image-only pages), the same underlying capability as image input. That collapses "text PDF," "scanned PDF," and "photo of a document" into one code path with one dependency (the Anthropic SDK, which I already need). It also means the "hard sub-problem" (documents that mix printed and handwritten content, or are scanned rather than born-digital) gets *actually solved* rather than gracefully declined. This is the single biggest reason the extraction pipeline is as simple as it is — see `server/src/services/fileTypes.js` for the resulting 3-way split (text / image / pdf).

**What this costs:** No `pdf-parse`-based fast path for pure-text PDFs (would've been cheaper/faster than a vision-capable call for the common case). I didn't think that optimization was worth a second code path for this build. Also means every PDF page counts against Claude's per-request size/page limits — mitigated by the file-size cap in §7, which keeps documents small enough that this isn't a practical concern here.

---

## 4. Supported file types, and what's explicitly out of scope

**Decision:** PDF, images (PNG/JPEG/WEBP/GIF), and plain text (TXT/MD/CSV/JSON/LOG). Anything else — most notably `.docx`/`.doc` — gets a clear `415` with an explanit message ("export or print to PDF first") rather than a silent failure or a confusing crash somewhere downstream. See `classifyFile()` in `server/src/services/fileTypes.js`.

**Reasoning:** `.docx` parsing needs another library (`mammoth` or similar) for a format users can trivially work around (every word processor can export/print to PDF, which the pipeline already handles well). Given the "no unnecessary libraries" constraint, this was an easy, deliberate cut — the alternative path (export to PDF) is genuinely not much user friction, and the failure mode is explicit and actionable instead of silent.

---

## 5. Storage: one Mongo collection, dynamic schema, not per-type collections or a vector DB

**Decision:** A single `Document` collection in MongoDB. The extracted structured data lives in one `fields` field typed as `Schema.Types.Mixed` — an arbitrarily-shaped object, whatever the model returned.

**Alternatives considered:**
- **A collection (or fixed schema) per document type** (`invoices`, `resumes`, ...). Rejected — the whole premise here is the document type isn't known ahead of time, so this would mean either guessing at a fixed set of types up front (contradicts §1) or dynamically creating collections/schemas at runtime, which is a lot of moving parts for marginal benefit.
- **A vector database**, for semantic search over document content. Rejected for this build: the query patterns needed (filter by a specific field like `total_amount >= 500`, or keyword match) are relational/text, not semantic-similarity search, and running two datastores (Mongo for the record + a vector store for search) for a project this size wasn't worth the operational complexity. If "find documents about a similar topic" were a real requirement, this would be the first thing I'd revisit.

**Reasoning:** Mixed/dynamic storage is the honest reflection of "we don't know the schema." The cost is that you can't put a normal index on `fields.total_amount` (it's an unpredictable path), which is exactly why search works the way it does — see §8.

---

## 6. Original file bytes live in MongoDB, not S3/Cloudinary

**Decision:** The uploaded file's raw bytes are stored as a `Buffer` field directly on the `Document` record (capped by the same size limit as upload — see §7), served back via `GET /documents/:id/file` with the right `Content-Type`.

**Alternatives considered:** Object storage (S3, Cloudinary, Netlify Blobs) is the "correct" answer at real scale — you don't want binary blobs bloating your primary database.

**Reasoning:** For this project's actual scale (a handful to a few hundred demo documents, each capped at a few MB), adding a second storage service and its credentials/config was complexity with no real payoff, and it's one more thing to explain in a setup README for someone grading this at 11pm. Storing the bytes alongside the record also means the "original vs. extracted" comparison in the UI (a real trust feature — let the user check our work) needed zero extra plumbing. If this needed to scale past a demo, this is the first thing I'd swap for object storage.

---

## 7. Hosting split: Netlify Functions + MongoDB Atlas, one deploy target

**Decision:** Netlify hosts both the static React build *and* the API, via one Express app wrapped with `serverless-http` as a Netlify Function (`netlify/functions/api.js`), redirected from `/api/*`. Data lives in MongoDB Atlas (free tier). The exact same Express app (`server/src/app.js`) also runs locally via plain `app.listen()` — see `server/src/index.js` — so there's one codebase, one set of route definitions, and no behavioral drift between "what I tested locally" and "what's deployed."

**Alternatives considered:** A separate long-running backend host (Render/Railway free tier) for a "real" persistent Express server, with only the frontend on Netlify.

**Reasoning:** One deploy target, one URL, one place to set environment variables — much simpler to hand someone a link and have it just work, and much simpler to reason about for a 1-person, short-timeline build. The real tradeoff is serverless constraints (see §7a–c below), which is a fair trade for the simplicity here.

### 7a. File size cap: Netlify's synchronous function payload limit

**Decision:** Uploads are capped at 4MB (`MAX_FILE_BYTES`, `server/src/config.js`), enforced both client-side (immediate feedback, no wasted upload) and server-side (defensive — never trust the client).

**Reasoning:** Netlify's synchronous Functions have a ~6MB request body ceiling. The upload payload is base64 (≈1.33× the original bytes) plus a small JSON envelope, so 4MB of original file comfortably clears that with headroom. This is a real constraint of the hosting choice in §7, surfaced honestly in the UI rather than discovered as a cryptic 502.

### 7b. Upload payload as base64 JSON, not multipart/form-data

**Decision:** The client reads the file with `FileReader`, sends `{ filename, mimeType, dataBase64 }` as a JSON body. No `multer`, no multipart parsing on the server.

**Reasoning:** `multipart/form-data` through AWS-Lambda-style serverless functions (what Netlify Functions are under the hood) is a well-known pain point — binary body handling depends on the platform correctly detecting and base64-decoding the content type, and it's a frequent source of "works locally, breaks in prod" bugs. Sidestepping it entirely by doing the base64 encoding client-side removes a whole dependency (`multer`) and a whole class of environment-specific bugs, at the cost of the ~33% base64 size overhead already accounted for in §7a.

### 7c. Serverless MongoDB connection caching

**Decision:** `server/src/db/connect.js` caches the connection *promise* at module scope and checks `mongoose.connection.readyState` before reconnecting, with a small `maxPoolSize: 5`.

**Reasoning:** Netlify Functions reuse warm Lambda containers between invocations. A naive `mongoose.connect()` called on every request would slowly leak connections across containers until Atlas's free-tier connection cap (500) is exhausted under any real traffic — a bug that's invisible in local dev (one process, one connection) and only shows up under concurrent serverless load. Caching the connection (and gating a fresh attempt behind a `.catch()` that resets the cache on failure, so a transient network blip doesn't wedge the app forever) handles this properly instead of hoping it doesn't come up.

---

## 8. Search: keyword baseline always works; natural-language search is a sanitized enhancement, not a leap of faith

**Decision:** Two modes behind one endpoint (`GET /query`):
- **Keyword** — a MongoDB `$text` index over a `searchableText` field, rebuilt on every save by recursively flattening the entire dynamic `fields` object (plus filename/docType/summary) into one string (`server/src/utils/flatten.js`). Works with zero external dependency, on any document shape.
- **Smart** — a natural-language question ("invoices over $100 from Acme") goes to Claude, which returns *proposed* structured filters through the same forced-tool-call pattern as extraction (§2). Falls back to keyword automatically — silently, from the user's perspective, beyond a small explanatory note — if smart search errors, isn't configured (no API key), or returns filters that match nothing. The user never hits a dead end.

**The part I actually want to highlight:** the model's proposed filters are **never** run against Mongo as-is. `sanitizeFilters()` in `server/src/services/queryBuilder.js` re-validates every proposed field against an explicit allowlist (`docType`/`summary`/`filename`, or `fields.<alphanumeric path>`) and every operator against a fixed map to real Mongo operators (`eq`/`gt`/`gte`/`lt`/`lte`/`contains`, the last regex-escaped before use). Anything outside that — a field like `$where`, an operator that isn't in the map, a value that's an object (which could otherwise smuggle in a Mongo operator like `{$gt: ""}`) — is silently dropped, not passed through. There's no `eval()`, no raw insertion of model output into a query anywhere in this codebase.

**Alternatives considered:** The obvious shortcut is asking the model to just write the Mongo query (or a Mongo aggregation pipeline) and running it directly. Much less code. Rejected outright — a user-controlled natural-language string influencing a database query, mediated by an LLM that could itself be prompt-injected via document content it previously extracted (e.g. a document containing text designed to manipulate a future search), is exactly the shape of a NoSQL-injection vector. This is covered by dedicated tests in `server/test/queryBuilder.test.js` (rejecting `$where`-style fields, rejecting object/array values, rejecting unknown operators, capping filter count).

**What I cut:** No pagination for search results (capped at 50, newest-first) — reasonable for a personal-document-library demo; would need real pagination at scale. No ranking/relevance blending between keyword and smart results — it's one mode or the other per query, not a merged score.

---

## 9. Processing is synchronous, not a background job queue

**Decision:** `POST /documents` does the whole thing in one request/response: validate → classify → call Claude → save → return the finished record. No "processing" status the client has to poll for in practice (see below).

**Alternatives considered:** Upload immediately, return `202 Accepted`, process in a background job, let the client poll or subscribe for status.

**Reasoning:** Netlify Functions have no durable queue to hand work off to — building one (SQS-alike + a poller, or a second service) is disproportionate infrastructure for a document-at-a-time assignment project. Synchronous keeps local and deployed behavior identical and the code simple.

**The tradeoff, stated plainly:** a large or multi-page document risks hitting the platform's function execution timeout, and the user's browser tab has to sit on an open request for however long extraction takes. Mitigated three ways: the file-size cap (§7a) keeps documents small, `extractStructuredData()` has its own internal timeout (`EXTRACTION_TIMEOUT_MS`, default 25s) so a slow call fails with a clear message rather than hanging until the platform kills it, and the `Document` record still exists with `status: "processing"` the instant it's created — so even if a request genuinely dies mid-flight, the app doesn't lose track of the upload; a page refresh will show it (as `processing`, retriable once bytes are confirmed present). The `status` field and the whole `processing → done/error` model in `Document.js` is deliberately there for this reason, even though the current single-region synchronous flow means most users never observe `processing` from the client the way they would with a real background queue.

---

## 10. Multi-file uploads are processed one at a time, not in parallel

**Decision:** When multiple files are dropped, `App.jsx` awaits each upload before starting the next.

**Reasoning:** Firing N synchronous LLM-calling requests at once from one client is an easy way to trip Anthropic API rate limits or pile concurrent invocations onto one Netlify Function, for a feature (batch upload) that isn't the core of the assignment. Sequential is slower for a big batch but simpler to reason about, and the in-flight UI (one card actively "uploading," the rest still queued as plain files) is honest about what's actually happening rather than showing five spinners that are secretly serialized anyway.

---

## 11. Frontend: plain React + hand-written CSS, nothing else

**Decision:** React + Vite, no additional runtime dependency. No `axios` (the `fetch`-based wrapper in `client/src/api/client.js` is ~15 lines and doesn't need it), no `react-router` (one screen with a detail panel doesn't need client-side routing), no component/CSS framework (hand-written CSS with custom properties for light/dark, in `client/src/index.css`).

**Reasoning:** Explicit instruction was to avoid unnecessary libraries and stay inside a stack I'm comfortable with as a MERN developer. Every one of those libraries is genuinely useful in a bigger app; none of them earns its weight here, and hand-writing the ~700 lines of CSS was also the more honest signal of actual front-end craft than dropping in a component kit.

---

## 12. First-run experience: bundled "try it now" samples

**Decision:** Two intentionally messy sample documents (a scrawled invoice, a disorganized meeting note — `client/src/sampleDocuments.js`) are one click away from the empty state, no file required.

**Reasoning:** Someone grading this won't necessarily have a "messy document" sitting on their machine, and asking them to go find one before they can see the thing work is unnecessary friction on literally the first thing they'd do with the app. This was cheap to build (plain text, no server changes — it goes through the exact same upload path as a real file) and removes the single biggest first-run drop-off point I could think of.

---

## 13. A passing test suite that still shipped two bugs — and what that changed

**What happened:** The Jest suite (`server/test/*.test.js`) — unit tests for the query sanitizer, file-type classifier, and text-flattening utility, plus a supertest integration suite against a pre-connected `mongodb-memory-server` — was fully green. I then ran a separate, deliberately more realistic manual smoke test (`GET`/`POST`/`DELETE` over real HTTP, against a freshly-booted app and a freshly-created in-memory database, with no pre-warmed connection) and it caught two real bugs the green suite had missed entirely:

1. **`GET /documents/:id/file` returned the file's content as a base64 *string* body**, not raw bytes. Cause: `.lean()` skips Mongoose's schema-based casting, so a `Buffer`-typed field came back as the MongoDB driver's raw BSON `Binary` object instead of a real `Buffer`, and `res.send()` on that silently stringified it. Fixed by not using `.lean()` for that one read (`getDocumentFile` in `documentsController.js` — the only place in the app that needs the real casted type, not a plain object).
2. **A `$text` search against a brand-new database threw `text index required for $text query`.** Cause: Mongoose builds schema indexes in the background and does not wait for that build before `.connect()` resolves; a request landing early enough loses the race. Fixed in `db/connect.js` by awaiting `Document.init()` (which resolves once indexes are confirmed built) as part of the same cached connection-promise chain every request already goes through — so the *first* request after a cold start pays that cost once, and nothing downstream needs to know it happened.

**Why the test suite didn't catch these:** the integration tests connect mongoose directly in `beforeAll` (bypassing `connectToDatabase()` and its index-await entirely) and check response *shape*, not exact byte content — both bugs live exactly in the gap between "the mocked/pre-warmed test path" and "a cold, real request." Also worth noting: the `fields: {}` case for unreadable documents surfaced a *third*, smaller bug during initial test-writing (not smoke-testing) — Mongoose's `minimize: true` default strips any key whose value is an empty object before saving, so an unreadable document's `fields` silently came back `undefined` instead of `{}`. Fixed with `minimize: false` on the schema, since "no data" and "we don't know" are meaningfully different signals here (see the schema comment in `Document.js`).

**What changed as a result:** I added `server/test/connect.test.js` — a dedicated regression test that goes through `connectToDatabase()` itself (not a pre-connected mongoose instance) and issues a `$text` query immediately, so this race can't quietly come back — and strengthened the file-serving test to assert exact byte content instead of just a status code and content-type header. I'm including this section because I think *how a bug was found and what changed afterward* is a more honest signal than a suite that was green from the start — a suite that only tests the happy mocked path will pass right up until the deployed app breaks in the exact gap it never looked at.

---

## 14. What's deliberately not built

Stated plainly, with the reasoning, so it reads as scoping rather than gaps I didn't notice:

- **No authentication / multi-user support.** Every document is visible to everyone who has the URL. Fine for a single-reviewer demo; the first thing I'd add for anything beyond that. Cut because auth is a well-understood, orthogonal problem that would have eaten build time better spent on the extraction/search pipeline this assignment is actually about.
- **No rate limiting on uploads or search.** A malicious or just enthusiastic user could run up an Anthropic API bill. Acceptable for a demo behind a link I control; would add before sharing this more broadly.
- **No retry/backoff on transient Anthropic API errors** (a dropped connection, a momentary 529) beyond the one explicit "Retry" button in the UI. Automatic retry-with-backoff is a reasonable next step; a manual retry that reuses the already-stored original file bytes (`POST /documents/:id/retry`) covers the common case without the added complexity of a queue.
- **No virus/malware scanning of uploaded files.** Out of scope for a document-structuring demo; would matter for a real multi-tenant product accepting arbitrary uploads.
- **No dark-mode toggle** — the UI follows the OS `prefers-color-scheme` automatically (see `index.css`), but there's no manual override control. Simpler, and covers the actual "does this look considered" bar without a settings surface for a single preference.

---

## 15. Rebuilding the frontend around a designed UI, mid-project — and what that changed

Everything above was written against a UI I designed myself (a single-page upload/search/detail app). Partway through, I designed a considerably more ambitious UI in Claude Design — three screens (Ingest / Review / Ask), a persistent Q&A chat widget, and a dark "Nocturne" design system — and exported it as a working prototype (`Sift.dc.html` + `support.js`, a small template/state runtime specific to Claude Design's canvas editor). This section is about the decisions in adopting it, not a redo of §1–14, which still describe the backend and mostly still hold.

**Decision:** Replace the hand-built frontend entirely rather than reskin it. The two don't share a shape — the original was one page with a modal; the design is three screens plus a floating assistant, built around a provenance mechanic (click a field, the exact source text lights up) that the original's side-by-side raw-file view doesn't have an equivalent of. Retrofitting the new visual language onto the old structure would have produced something that looked like Sift but didn't behave like it. Renamed the product **Sift** to match.

**Decision, and the harder call: build in two phases, UI first.** The design's own "States" panel — a debug switcher covering 15 real-world scenarios (upload failures, stalled processing, cross-document conflicts, model timeouts, a citation-required refusal state, offline, quota, session expiry, a 404) — is honestly a better edge-case spec than I'd have written myself. But several of those scenarios (offline sync, session/auth expiry, billing quotas, folder-level access control) imply infrastructure — auth, a billing system, an offline write queue — that's real product work outside a document-extraction assignment, and that I'd already deliberately cut in §14. Rather than either (a) building that infrastructure to make every scenario "real," or (b) skipping the States panel to avoid the question, the actual decision was: **keep the panel in the shipped app as a genuine feature**, backed by real logic for the scenarios the real pipeline can actually produce (upload validation failures, extraction errors and timeouts, blank/unreadable documents, a citation-required refusal), and by the prototype's own demo data for the ones that need infrastructure I'm not building. That split is the honest version of "above and beyond" here — it demonstrates the edge cases were thought through end-to-end, without pretending to have built auth and billing I didn't build.

Concretely, this is a two-phase build:
- **Phase A (this pass):** Port the design faithfully to React — same Nocturne tokens (`client/src/styles/nocturne.css`, copied verbatim per the design system's own guidance: "take every color, font, spacing, radius and shadow from its variables"), same three screens, same chat widget and States panel — running entirely on a local demo engine (`client/src/store/useSiftDemo.js`) ported from the prototype's own state/logic, so the UI/UX can be verified and signed off before any backend work depends on it.
- **Phase B (next):** Wire it to the real API. This is a bigger backend change than a simple reskin implies — see the provenance decision below — and comes only after the UI itself is confirmed right, which is the explicit order the assignment's iteration asked for.

**What I did NOT try to preserve from the prototype:** its markup style. `Sift.dc.html` expresses every element as a large inline `style="..."` string — normal, even necessary, for a design-canvas tool built around click-to-select and a properties panel — but not something to ship. `client/src/styles/app.css` is that same visual system translated into real, reusable classes (still built only from Nocturne's `var(--*)` tokens, never a hard-coded value); the components in `client/src/components/` read as ordinary React, not as a template-engine port.

**Provenance is a real, harder change — not just UI.** The design's Review screen links each extracted field to the literal span of source text it came from. The prototype achieves this with hand-authored data (each line of document text is pre-split into `[text, fieldId]` segments) — fine for a mockup with two fixed example documents, meaningless once real documents produce fields the app has never seen the shape of. Making this real for Phase B means changing what extraction returns: alongside `value`, each field needs a verbatim `quote` copied from the document, checked as a real substring match (not trusted blindly — a hallucinated quote just doesn't highlight, it doesn't corrupt anything), against a full document transcription the model also has to produce (so image/PDF documents get the same mechanism as text ones, via one transcript instead of three different code paths). That's a genuine extraction-pipeline change, and it's deliberately being done as its own step after the UI is validated, not bundled into this pass.
