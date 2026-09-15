# decisions.md

The calls that shaped **Sift**, what I seriously considered instead, and what I left out on purpose — including the places where production told me I was wrong.

---

### 1. The model decides the schema, not me

The brief said *messy documents*. The safe reading is: pick one type — invoices — hard-code a schema, extract against it. Reliable, demoable, and to anyone who has seen an invoice parser, unremarkable. It also quietly deletes the actual problem, because if you already know the schema, the document was never unstructured.

So extraction returns whatever fields the document actually has. A lease yields `rent` and `notice_period`; a prescription yields `medications` and `nhs_number`; nothing is declared in advance. That propagates everywhere: documents store an array of self-describing field descriptors rather than typed columns, the search index is built by flattening whatever came back, and search is grounded in the field keys actually observed rather than a fixed list.

One concrete tradeoff falls out of it. Search filters query a flat `fieldIndex.<key>` shadow of the fields array rather than `$elemMatch` against the array itself. `$elemMatch` is the more "correct" query, but it would push real complexity into the filter sanitiser — the one function most worth keeping small and auditable — to support filtering on field *metadata* that search never used.

The price, accepted deliberately, is no per-type UI — no invoice line-item table, no resume timeline. A domain-specific build would screenshot better. I would rather be judged on the part that is hard.

### 2. Built for one person holding one document that matters

Not a finance team processing 500 invoices a day; they have a schema and a vendor already. This is for someone with a twelve-page tenancy agreement they are about to sign, or a prescription in handwriting they need to read out to a friend collecting the medicines.

That persona is load-bearing rather than decorative. Low-frequency and high-stakes means one document at a time, watched — which is why synchronous processing is *correct* here rather than a compromise, and why I spent the infrastructure budget on making long documents work instead of on a job queue. A durable queue was the obvious "production-grade" move and would have bought this user nothing.

It also sets the bar for the interface. Someone in that position needs the facts pulled out without being asked to define "the facts", a way to check the machine's work before acting on it, honesty about what was uncertain, and a warning before they forward something they shouldn't. Features that didn't serve one of those four didn't get built — and one that stopped serving them got deleted late on, when I couldn't justify it out loud.

### 3. The model is never trusted, structurally

Every AI call uses forced tool use: Claude is handed a schema and required to call it, so there is no `JSON.parse()` on model prose anywhere in the codebase. That removes the commonest failure mode in LLM apps by construction, rather than by wrapping a parser in retries.

Beyond format, three things treat the model as hostile. Smart search lets it propose MongoDB filters, so a sanitiser whitelists the permitted field paths — NoSQL-injection prevention where the attacker is the model. Every citation in an answer is re-checked against the database: does that document exist, is it finished, does it genuinely have that field. And if nothing survives that check while the model claimed an answer, the response becomes a refusal, because an answer whose citations don't verify is a guess in a costume.

The alternative — trust the output, validate loosely — is faster and fine for a demo. For someone about to sign a lease or measure a dose, a confident wrong answer is worse than none, so the extra layer earns its keep.

### 4. Show where every value came from

Each field carries a verbatim quote from the document, and clicking a value highlights that exact span in the original. The alternative, showing a confidence score and asking for trust, fails at the only moment that matters: checking the deposit figure against the actual clause before signing. On the sample agreement — which says 2,175.00 in clause 4 and 2,750.00 in Schedule A — the UI shows the contradiction and offers a button for each reading, and records *which one a human picked* rather than inferring a new number from it.

I considered drawing bounding boxes over the source image, which looks more impressive and is far more work. Substring matching against the model's own transcription reaches the same outcome and degrades safely: a quote that isn't really in the text just doesn't highlight, rather than breaking the page.

Cut: per-leaf provenance for compound values. A medication list is one field with one quote covering its region, not one quote per medicine. That's a scoping call, and I'd rather name it than have it discovered.

### 5. A long document is a sequence of chunks, not one call

A ten-page scanned agreement takes longer to read than any serverless platform will hold a request open. Raising the timeout is the obvious fix and merely moves the failure to page twenty. So a document became a sequence of bounded chunks — real smaller PDFs, each its own model call, results saved after *every* chunk, with a resume pointer. A timeout, a crash or a closed laptop costs you one chunk, not the document.

Production corrected me twice. The first deploy returned `504 Inactivity Timeout`: my request budget decided whether a chunk could *start*, not whether it could finish, so a chunk beginning at 29s ran the request past the limit — bounded at the wrong end. Then a genuinely signed agreement failed outright, because it was scanned and the model was reading pixels. I measured rather than guessed: a typical page took **20.7s**, a dense one **34.1s**. Now a slow chunk retries at half size, and a page that still won't read is skipped and *named* — "pages 2–5 couldn't be read" — instead of losing the three that read perfectly well. That one document went from an error with zero fields to 34 fields and an honest note about the gap.

What I haven't done, and won't pretend otherwise: a 34-second page cannot be read inside a synchronous request at all. That needs background functions with polling — an architecture change, not a tuning knob — so it's written down rather than half-built.

### 6. No vector database

The reflex for "ask questions about your documents" is embeddings and a vector store. I went the other way for a specific reason: extraction has *already* structured the corpus. Re-embedding text I've just parsed into labelled fields is less precise than grounding the model in those fields directly, at the scale one person's documents reach. Running a second datastore to do a worse job isn't a tradeoff worth making.

It buys more than simplicity. Answers cite specific fields rather than vague passages, which is what makes verification possible at all — and two features fell out of it: conflict detection when two documents disagree on the same field, and "Ask this document", where the digest contains exactly one document so an answer from elsewhere is impossible rather than discouraged.

Cut: cross-document entity resolution. Conflict detection works when two documents use the same field key; recognising that `price_escalator_note` and `price_cap_percentage` describe the same fact is a much larger problem. I'd revisit embeddings the day "find documents about a similar topic" becomes a requirement — that's the query they're actually for.

### 7. Privacy enforced in one place, not twenty

One public link originally meant one shared pile of documents, so sending someone the link handed them your tenancy agreement. The obvious fix is scoping every database query by visitor. There are about twenty of them, and one forgotten `.find()` is a silent leak no obvious test catches.

So the session rides in `AsyncLocalStorage` and is injected into every query by Mongoose middleware. A rule that must hold everywhere belongs somewhere it can't be bypassed by forgetting, and queries written later inherit it for free. Accounts would have solved this too, at the cost of a signup flow nobody wants before reading one lease.

Reality corrected me twice again. Deleting data when the browser says goodbye seemed obvious until I noticed that event also fires on *reload* — pressing F5 destroyed everything you'd uploaded. Leaving now schedules an expiry that a returning tab cancels. And my own test helper turned out not to be testing anything: it built a query but returned before running it, so the isolation context had already closed and the queries ran unscoped. Production was never affected, but the tests were quietly lying, which is worse than tests that fail.

### 8. Tests aimed at what would actually hurt

113 tests, run in randomised order so none passes by accident of sequence. They're pointed at properties rather than coverage: that a citation to a nonexistent document is dropped, that a more confident later chunk cannot clear an earlier "needs checking" flag, that one visitor cannot open another's document even knowing its id.

Separately there's a golden eval — sixteen real questions against the real endpoint, scoring retrieval accuracy apart from generation accuracy, because a prompt tweak can't fix a retrieval miss and one number hides which half broke. It sits deliberately outside `npm test`: it makes real API calls that cost real money, and a suite you're reluctant to run is a suite nobody runs.

Setup is one install and one command, and the app runs with no API key at all — uploads save, extraction reports a clear reason per document, search falls back to keyword, and a banner explains why. Anyone evaluating this should see it work before it asks them for a credit card.

---

### What I left out, in one place

Accounts and multi-user, a job queue, a vector index, cross-document entity resolution, per-type UI, per-leaf provenance, `.doc`/audio/video/archives, and background functions for genuinely unreadable scanned pages.

Every one is a real capability and several are what I'd build next. They're absent because the time went into the parts this user actually feels: that a long document doesn't lose its work, that every number can be traced to the line it came from, and that an answer nobody can verify never gets shown at all.
