# [decisions.md](http://decisions.md)

**Sift** takes a document you can't fully read and turns it into information you can search, check, and ask questions about.

This file is the record of what I decided while building it, what I considered instead, and what I deliberately left out.

---

## Who I built this for

One person, one document that matters, read carefully. It is not built for a finance team processing 500 invoices a day. Those teams already know what their documents look like and can buy software that handles them.

What that person actually needs, in order of importance:

1. The facts pulled out, without being asked to define what "the facts" are
2. A way to check the machine's work before acting on it
3. Honesty about anything that wasn't clear
4. A warning before they forward something they shouldn't

Every decision below traces back to one of those four. Anything that didn't, I didn't build.

---



## Where this started, and what I traded away

That is not where I began.

The first thing I wanted to build was a permission-aware knowledge system for a B2B software company. I'm deliberately not calling it a PDF chatbot, because the interesting part isn't the chat.

The idea: an account manager needs an answer that lives scattered across project documentation, support tickets, call transcripts, internal policies, maybe a Slack export. They ask something like *"what did we promise this customer, and has the product team committed to a delivery date?"* The system gives them a grounded answer with citations, shows them only what they're actually authorised to see, and warns them when something is confidential and shouldn't be repeated back to the customer.

I still think that's a good product. I didn't build it, for two reasons.

**Most of the work is in the permissions layer, and permissions are plumbing.** Roles, an organisation model, per-document access rules, and a way to be confident someone never sees a line they shouldn't. That is a lot of well-understood work, and none of it is the interesting part of the problem. A week spent there would have produced a thin, generic answering engine sitting on top of a large pile of access-control code.

**I couldn't have tested it honestly.** I don't have a company's support tickets, call transcripts or Slack history. I would have had to invent every one of them, and a system that has only ever seen data I wrote for it to see is not a system I have actually tested.

So I cut it down to one person and one document. What I'd point out is how much of the original idea survived that cut:


| From the original idea                               | What happened to it                                                                                                                       |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Answers grounded in citations                        | Kept, and hardened. Every citation is checked against the real record before it's shown.                                                  |
| Warning that something is confidential               | Kept. Each extracted value can be flagged sensitive, and you're warned before you share it.                                               |
| Answering across several sources at once             | Kept at smaller scale. Answers span documents, and it tells you when two of them disagree.                                                |
| Saying "I don't know" instead of guessing            | Kept, and it's enforced rather than requested.                                                                                            |
| Keeping one person's information away from another's | Kept in a simpler form. Every visitor gets an isolated space, and the mechanism that does it is the same one you'd use for real accounts. |
| Roles and permissions                                | Cut. The largest piece of work and the least interesting.                                                                                 |
| Connectors for tickets, transcripts, Slack           | Cut. No honest test data.                                                                                                                 |
| Shared team workspaces                               | Cut. Follows from cutting accounts.                                                                                                       |


The version I built is smaller, but the part I most wanted to get right (an answer you can check, that refuses when it should) is the part I kept.

---



## How I spent the week

Roughly half of it before writing any application code.

About **two and a half days on the problem itself**: what the product should be, who it was for, which reading of the brief was worth building. That included letting go of the enterprise idea above, which took longer than I'd like to admit.

Then about **a day building a prototype in Claude Design**. Not styling, and not throwaway. I wanted to see all three screens and every state they could be in before committing to any of it: what an empty screen looks like, what a rejected file looks like, what an answer with nothing to support it looks like. Designing the failure states up front is the reason they aren't bugs I found later.

That prototype ended up covering fifteen distinct states. Six of them are now driven by the real backend. The rest need infrastructure I chose not to build.

That left roughly **three and a half days to build**, which is why so much of what follows is about what I didn't do.

---



## The constraints I was working inside

**One week**, half of it spent deciding what to build.

**MERN only, and no library unless I could name the problem it solved.** I know React, Node, Express and MongoDB well. Learning a new datastore mid-build would have cost me the time I wanted to spend on the actual problem. This is also part of the honest answer to "why no vector database" later on. There's an architectural reason too, and I think it's the stronger one, but familiarity was genuinely part of it and I'd rather say so.

The dependencies I did add each do exactly one job: the Anthropic SDK to call the model, `pdf-lib` to split PDFs by page, `mammoth` to read Word files, `serverless-http` so the same Express app runs on Netlify. No state management library, no UI kit, no CSS framework.

**$10 of Anthropic credit.** That shaped more than I expected, because reading a document costs money every single time, and reading a *scanned* document costs considerably more than a text one, since the model is working through an image rather than characters. I couldn't iterate by brute force. When a long scan behaved oddly I measured it once and reasoned about the result, instead of re-running until something worked.

Three decisions come straight out of that budget:

- **Results are saved after every piece of a long document.** If a ten-page read fails on page nine, I've already paid for nine pages and I'm not paying for them twice.
- **The scoring run is not part of the normal test command.** Each run reads five documents and asks sixteen questions against the real model. That should be a deliberate choice, not something firing on every commit.
- **Suggested questions are cached** and only regenerated when the documents actually change, rather than on every page load.

---



## The decisions



### 1. Don't pick a document type

This was the first real decision, and everything else follows from it.

The obvious build is an invoice parser. You decide you're doing invoices, you write down the fields an invoice has, and you extract against that list. It works, it demos well, and it is a solved problem.

I didn't do that, because it avoids the actual difficulty. If you already know the document is an invoice and you already know which fields to look for, the document was never really messy. The hard version of this problem is not knowing what's coming.

So Sift has no document types and no templates. It reads whatever you give it and reports what it found. A lease comes back with rent and notice period. A prescription comes back with medications and an NHS number. None of that is decided in advance.

What this cost me: there's no tailored screen for any particular kind of document. No invoice line-item table, no timeline view for a CV. A narrower build would look more finished in a screenshot, and I decided I'd rather be judged on the harder part.

One technical consequence is worth explaining, because it's a genuine tradeoff. Since every document has different fields, they're stored as a list of self-describing entries rather than as fixed columns. But search needs to filter on those values, and filtering inside a list is awkward in MongoDB. So alongside the list I keep a simple flat copy of the same values, used only by search. That's duplicated data, which I normally avoid. I accepted it because the alternative pushed real complexity into the one piece of code I most wanted to keep small and easy to check by eye, which is the part that validates AI-generated search filters before they reach the database.

### 2. Never trust what the model sends back

Every call to the model is set up so it has to answer in a fixed shape. I give it a form and it has to fill that form in. It cannot reply with a paragraph that I then try to interpret. That means there is nowhere in this codebase that takes the model's writing and tries to parse it, which is the most common way applications like this break.

Getting the shape right isn't enough, though, because the contents can still be wrong. Three things treat the model as untrusted:

**Search filters.** The model helps turn a plain-English question into a database query. I don't run what it gives me. A whitelist checks which fields it is allowed to filter on and rejects anything else. This is ordinary injection protection, except the untrusted input is the AI rather than a person.

**Citations.** When you ask a question, the answer names the documents and values it came from. Before any of that reaches the screen, I look each one up. Does that document exist? Has it finished processing? Does it genuinely have that value? Anything that fails is dropped.

**Refusal.** If none of the citations survive that check but the model still claimed to have an answer, the answer is thrown away and you get a refusal instead. An answer whose sources don't exist is not an answer.

The quicker option was to trust the output and validate loosely, which is fine for a demo. For someone about to sign a lease or measure out a dose, a confident wrong answer is worse than no answer at all.

### 3. Show where every value came from

Each extracted value carries the exact sentence it came from. Click the value and that sentence lights up in the original document.

This is the answer to needing to check the machine's work. Showing a confidence score and asking you to trust it falls apart at the one moment that matters, which is when you want to verify the deposit figure against the actual clause before signing.

The sample agreement built into the app is written to exercise this on purpose. It states the deposit as 2,175.00 in one clause and 2,750.00 in a schedule further down, which is the kind of thing that really does happen in a contract and really is easy to miss. Sift catches the contradiction, shows both figures, and asks which one is right. It records which reading the person chose. It does not try to work out a new number from that choice, because recording what someone decided is honest and guessing what they meant by it is not.

I considered drawing boxes over the original image instead, which looks more impressive. It's also considerably more work, and matching the text gets to the same place. It fails gracefully too: if the model reports a sentence that isn't really in the document, that value simply doesn't highlight. Nothing breaks.

What I cut: this works at the level of a whole value, not each part of one. A prescription's medication list is one value with one source sentence covering it, not a separate source for every medicine. That's a scoping decision and I'd rather name it than let someone discover it.

### 4. Read long documents in pieces

A long scanned agreement takes longer to read than any hosting platform will keep a request open. The easy fix is to raise the time limit, which just moves the failure to a longer document.

So a document isn't one request any more. It's split into small pieces, each read separately, and **the results are saved after every single piece**. If something fails halfway, you keep everything read so far and it carries on from where it stopped rather than starting again. A timeout or a closed laptop costs you one piece, not the document. On a $10 budget it also means a failure doesn't throw away work I've already paid for.

Two things went wrong in production that I could not have predicted from my machine.

The first deploy returned a timeout error from the edge. The bug was in how I'd defined the time budget: it checked whether there was time to *start* another piece, not whether there was time to finish one. A piece starting at 29 seconds would run the whole request past the limit. I was measuring the wrong end.

Then I uploaded my actual signed agreement, which is a scan, so the model is reading pixels rather than text. Every piece timed out, and because a failed document couldn't be opened and retrying repeated exactly the same failure, it was a dead end with nothing to show.

Rather than guess, I measured how long a scanned page really takes. A normal page took 20.7 seconds. A dense one took 34.1. So now a piece that times out is retried at half the size, and a single page that still won't read is skipped and **named** ("pages 2 to 5 couldn't be read") instead of failing the whole document. That same agreement went from an error with nothing in it to 34 values extracted and an honest note about the gap.

There's a limit I'm not going to pretend around. A page that takes 34 seconds cannot be read inside a request at all. Fixing that properly means moving to background processing with the page polling for updates, which is a change in architecture rather than a change in settings, so I've written it down rather than half-building it.

### 5. No vector database

The standard answer for "ask questions about your documents" is embeddings and a vector database. I went a different way, and the reason is specific rather than lazy.

Extraction has *already* turned the documents into structured information. Converting that text back into vectors to search over it is less precise than simply giving the model the values it already produced. At the scale one person's documents actually reach, adding a second database to do a worse job isn't a trade I'd make. It would also have meant a second thing to run, configure and pay for, inside a week and a $10 budget.

It buys something, too. Answers point at specific values rather than vague passages, which is what makes checking them possible in the first place. Two features came out of that almost for free: noticing when two documents disagree about the same thing, and "Ask this document", where only that one document is given to the model so an answer from anywhere else is impossible rather than just discouraged.

What I cut: recognising that two documents describe the same fact under different names. Disagreements are caught when both documents use the same field name. Working out that `price_escalator_note` and `price_cap_percentage` mean the same thing is a much bigger problem than it sounds, and I'd rather name it than quietly leave it broken. It's also the piece the enterprise version would have needed most.

I would revisit embeddings the day "find documents about a similar topic" becomes a requirement, because that is the question they're actually good at.

### 6. Your documents are yours, and they don't stick around

This is one public link. In the first version, everyone who opened it saw the same pile of documents, which means sending someone the link would have handed them my tenancy agreement. For a product built around documents you'd think twice about forwarding, that's the worst possible default.

Every visitor now gets their own private space with no account to create, and their documents are cleared when they leave.

The part I'd point to is where that rule is enforced. The obvious approach is to filter every database query by visitor. There are around twenty of those queries, and forgetting one is a silent privacy leak that no obvious test would catch. So instead, the visitor's identity is attached to the request itself and added to every query automatically, in one place. A rule that has to hold everywhere shouldn't depend on remembering it, and anything written later gets it for free. It is also the same mechanism real accounts would use, which is why this was the one piece of the original enterprise idea I could keep cheaply.

Reality corrected me twice here. Deleting everything when the browser closes seemed obvious until I noticed the browser fires that same signal on a page refresh, so pressing F5 was wiping everything you'd uploaded. Leaving now schedules a deletion shortly afterwards, and coming back cancels it.

The second one is more embarrassing and more useful. A helper in my test suite built a database query but returned before running it, which meant the privacy rules weren't applied during those tests at all. The tests were passing without testing the thing they claimed to test. Real users were never affected, because the live code path was correct, but a test that quietly lies is worse than one that fails.

### 7. Test the things that would actually hurt

There are 113 tests, run in a random order so that none of them pass by accident of sequence.

They're aimed at behaviour rather than at coverage numbers. A citation pointing at a document that doesn't exist gets dropped. A later, more confident reading of a page can't quietly clear a warning raised by an earlier one. One visitor can't open another visitor's document even if they know its ID.

There's also a separate scoring run: sixteen real questions asked against the real system, measuring two things apart from each other. Did it find the right information, and did it give the right answer. Those fail for different reasons, and a single score would hide which half broke.

Setup is one install and one command. The app also runs with no API key at all: uploads still save, each document explains clearly why it couldn't be read, search falls back to keyword matching, and a banner says what's missing. Anyone evaluating this should be able to see it work before it asks them for a credit card.

---



## What I left out, and why

Accounts, roles and permissions. Connectors for tickets, transcripts and Slack. Shared team workspaces. A job queue. A vector database. Matching the same fact across documents that name it differently. Tailored screens per document type. Source sentences for every item inside a list. Support for `.doc`, audio, video and archives. Background processing for scanned pages too slow to read in one request.

Every one of those is a real feature and several are what I'd build next. They're missing because I'd rather hand over something small that works and that I can explain line by line than something broad that falls over the first time a real document hits it.