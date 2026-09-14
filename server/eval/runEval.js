#!/usr/bin/env node
// Golden eval for /ask — NOT part of `npm test`, NOT run in CI. This makes
// real Claude API calls (extraction for 5 fixtures + one /ask call per
// question) and costs a small but real amount of API usage. Run by hand:
//
//   npm run eval --workspace server
//
// Scores retrieval quality (did the verified citations name the right
// source documents) SEPARATELY from generation quality (did the answer say
// the right thing, or correctly refuse) — a prompt tweak can't fix a
// retrieval miss, so conflating the two numbers would hide that. See
// decisions.md.
require('dotenv').config();

const FIXTURES = require('./fixtures');
const QUESTIONS = require('./questions.json');

function containsAny(haystack, needles) {
  const h = (haystack || '').toLowerCase();
  return needles.some((n) => h.includes(String(n).toLowerCase()));
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not set — this script makes real model calls and needs one. Set it in server/.env.');
    process.exit(1);
  }

  const { MongoMemoryServer } = require('mongodb-memory-server');
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();

  const http = require('http');
  const { createApp } = require('../src/app');
  const app = createApp();
  const server = http.createServer(app);
  // Port 0 = let the OS pick a free one. Nothing outside this process ever
  // connects to this server, so a fixed port buys nothing and costs a lot:
  // if it's already taken, `listen` emits an unhandled 'error' and the run
  // hangs silently forever instead of failing. (Learned the hard way — an
  // earlier eval process left over from a previous run held the port and
  // every subsequent run just sat there.)
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, resolve);
  });
  const base = `http://localhost:${server.address().port}`;

  try {
    console.log(`Seeding ${FIXTURES.length} fixture documents through the real upload/extraction path...\n`);
    const aliasToId = {};
    for (const fixture of FIXTURES) {
      const res = await fetch(`${base}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: fixture.filename,
          mimeType: 'text/plain',
          dataBase64: Buffer.from(fixture.text).toString('base64'),
        }),
      });
      const doc = await res.json();
      if (doc.status !== 'done') {
        console.warn(`  ! ${fixture.alias} (${fixture.filename}) did not finish cleanly: ${doc.errorMessage || doc.status}`);
      }
      aliasToId[fixture.alias] = doc._id;
      console.log(`  - ${fixture.alias} -> ${doc._id} (${(doc.fields || []).length} fields)`);
    }

    console.log('\nRunning golden questions against the real /ask endpoint...\n');
    const rows = [];
    for (const q of QUESTIONS) {
      const res = await fetch(`${base}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q.question }),
      });
      const answer = await res.json();

      let retrievalPass;
      if (q.expectedRefusal) {
        retrievalPass = true; // nothing to retrieve for a question expected to refuse
      } else {
        const citedDocIds = new Set((answer.citations || []).map((c) => c.documentId));
        retrievalPass = (q.expectedDocAliases || []).every((alias) => citedDocIds.has(aliasToId[alias]));
      }

      let generationPass;
      if (q.expectedRefusal) {
        generationPass = answer.refused === true;
      } else if (q.expectedAnswerContains && q.expectedAnswerContains.length > 0) {
        generationPass = answer.refused === false && containsAny(answer.answer, q.expectedAnswerContains);
      } else {
        // No specific content asserted (e.g. the conflict question, which is
        // primarily checking retrieval + the caveat, reported separately) —
        // just require that it didn't wrongly refuse.
        generationPass = answer.refused === false;
      }

      const conflictNote = q.expectConflictCaveat
        ? (answer.caveats || []).some((c) => c.type === 'conflict') ? 'conflict caveat: yes' : 'conflict caveat: no (see note)'
        : null;

      rows.push({ id: q.id, category: q.category, retrievalPass, generationPass, conflictNote, question: q.question });
    }

    console.log('ID    Category              Retrieval  Generation  Question');
    console.log('-'.repeat(90));
    for (const r of rows) {
      console.log(
        `${r.id.padEnd(6)}${r.category.padEnd(22)}${(r.retrievalPass ? 'PASS' : 'FAIL').padEnd(11)}${(r.generationPass ? 'PASS' : 'FAIL').padEnd(12)}${r.question}`
      );
      if (r.conflictNote) console.log(`      -> ${r.conflictNote}`);
    }

    const retrievalAccuracy = (rows.filter((r) => r.retrievalPass).length / rows.length) * 100;
    const generationAccuracy = (rows.filter((r) => r.generationPass).length / rows.length) * 100;
    console.log('\n' + '='.repeat(50));
    console.log(`Retrieval accuracy:  ${retrievalAccuracy.toFixed(0)}%  (right documents cited)`);
    console.log(`Generation accuracy: ${generationAccuracy.toFixed(0)}%  (right answer / correct refusal)`);
    console.log('='.repeat(50));
    console.log('\nThis is a sanity check, not a submission gate — see decisions.md.');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await mongod.stop();
  }
}

main().catch((err) => {
  console.error('Eval run failed:', err);
  process.exit(1);
});
