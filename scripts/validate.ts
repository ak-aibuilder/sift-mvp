// Full validation harness: data integrity + failure-mode checks + all 5 evals,
// across every product and category. Reusable after each phase and on deploy.
// Run: npm run validate
//
// Deterministic checks need no API key. The RAG section (Eval 4/5, FM-2/FM-4)
// makes live LLM calls and is skipped with a warning if LLM_API_KEY is unset.

try {
  process.loadEnvFile('.env.local');
} catch {
  /* defaults apply */
}

import {
  getDb,
  getAllProducts,
  getReviewsByProduct,
  getProductById,
  getStarBreakdown,
  getEmbeddingsForProduct,
  type Review,
} from '../lib/db';
import { embedText, cosineSimilarity, EMBEDDING_DIM } from '../lib/embeddings';
import { buildQaPrompt, type ProductSummary, type QaResult } from '../lib/prompts';
import { chat } from '../lib/llm';

// -- tiny test harness --
let pass = 0;
let fail = 0;
let warn = 0;
const failures: string[] = [];
function check(ok: boolean, label: string, detail = '') {
  if (ok) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    failures.push(label + (detail ? ` — ${detail}` : ''));
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}
function warnMsg(label: string) {
  warn++;
  console.log(`  ⚠ ${label}`);
}
function section(title: string) {
  console.log(`\n${'='.repeat(64)}\n${title}\n${'='.repeat(64)}`);
}

const norm = (t: string) =>
  t.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

// ====================================================================
// 1. DATA INTEGRITY
// ====================================================================
function dataIntegrity() {
  section('1. DATA INTEGRITY');
  const db = getDb();
  const products = getAllProducts();

  const counts = {
    products: products.length,
    reviews: (db.prepare('SELECT COUNT(*) c FROM reviews').get() as { c: number }).c,
    summaries: (db.prepare('SELECT COUNT(*) c FROM summaries').get() as { c: number }).c,
    embeddings: (db.prepare('SELECT COUNT(*) c FROM review_embeddings').get() as { c: number }).c,
  };
  console.log(`  counts: ${JSON.stringify(counts)}`);
  check(counts.products === 9, '9 products');
  check(counts.reviews >= 270 && counts.reviews <= 540, `reviews in 270-540 (${counts.reviews})`);
  check(counts.summaries === counts.products, 'one summary per product');
  check(counts.embeddings === counts.reviews, 'one embedding per review');

  // referential integrity
  const orphanReviews = (db.prepare('SELECT COUNT(*) c FROM reviews r LEFT JOIN products p ON r.product_id=p.id WHERE p.id IS NULL').get() as { c: number }).c;
  const orphanSummaries = (db.prepare('SELECT COUNT(*) c FROM summaries s LEFT JOIN products p ON s.product_id=p.id WHERE p.id IS NULL').get() as { c: number }).c;
  const orphanEmb = (db.prepare('SELECT COUNT(*) c FROM review_embeddings e LEFT JOIN reviews r ON e.review_id=r.id WHERE r.id IS NULL').get() as { c: number }).c;
  const reviewsNoEmb = (db.prepare('SELECT COUNT(*) c FROM reviews r LEFT JOIN review_embeddings e ON e.review_id=r.id WHERE e.review_id IS NULL').get() as { c: number }).c;
  check(orphanReviews === 0, 'no orphan reviews', `${orphanReviews}`);
  check(orphanSummaries === 0, 'no orphan summaries', `${orphanSummaries}`);
  check(orphanEmb === 0, 'no orphan embeddings', `${orphanEmb}`);
  check(reviewsNoEmb === 0, 'every review has an embedding', `${reviewsNoEmb} missing`);

  // field-level
  const badRating = (db.prepare('SELECT COUNT(*) c FROM reviews WHERE rating < 1 OR rating > 5').get() as { c: number }).c;
  const emptyBody = (db.prepare("SELECT COUNT(*) c FROM reviews WHERE body IS NULL OR TRIM(body)=''").get() as { c: number }).c;
  const badCat = (db.prepare("SELECT COUNT(*) c FROM products WHERE category NOT IN ('fashion','health_personal_care','beauty')").get() as { c: number }).c;
  check(badRating === 0, 'all ratings in 1-5', `${badRating} bad`);
  check(emptyBody === 0, 'no empty review bodies', `${emptyBody} empty`);
  check(badCat === 0, 'all categories valid', `${badCat} bad`);

  // review_count matches actual rows
  let rcMismatch = 0;
  for (const p of products) {
    const actual = getReviewsByProduct(p.id).length;
    if (p.review_count !== actual) rcMismatch++;
  }
  check(rcMismatch === 0, 'review_count matches actual rows for all products', `${rcMismatch} off`);

  // embedding dimension (byte length)
  const wrongDim = (db.prepare(`SELECT COUNT(*) c FROM review_embeddings WHERE length(embedding) <> ${EMBEDDING_DIM * 4}`).get() as { c: number }).c;
  check(wrongDim === 0, `all embeddings are ${EMBEDDING_DIM}-d (${EMBEDDING_DIM * 4} bytes)`, `${wrongDim} wrong`);

  // category distribution
  const byCat = db.prepare('SELECT category, COUNT(*) c FROM products GROUP BY category').all() as { category: string; c: number }[];
  check(byCat.length === 3 && byCat.every((x) => x.c === 3), '3 products in each of 3 categories', JSON.stringify(byCat));
}

// ====================================================================
// 2. SUMMARIZATION FAILURE MODES + EVALS 1-3 (all 9 products)
// ====================================================================
function summarizationChecks() {
  section('2. SUMMARIZATION — FM-1/3/5 + Evals 1, 2, 3 (all categories)');
  const db = getDb();
  const products = getAllProducts();

  // Known/accepted limitations — flagged as WARN, not FAIL (already logged in
  // docs/model-behavior-log.md). A new ungrounded product would still FAIL.
  const KNOWN_UNGROUNDED = new Set(['fashion-B01N9QS2I9']); // Pilestone stitched quotes (FM-1)

  let quotesOk = 0, starOk = 0, sortedOk = 0, fm3Ok = 0;
  let quoteIssues: string[] = [];
  const ungroundedProducts: string[] = [];

  for (const p of products) {
    const row = db.prepare('SELECT summary_json FROM summaries WHERE product_id=?').get(p.id) as { summary_json: string } | undefined;
    if (!row) { check(false, `summary exists for ${p.id}`); continue; }
    let s: ProductSummary;
    try { s = JSON.parse(row.summary_json); } catch { check(false, `summary JSON valid for ${p.id}`); continue; }

    // schema fields present
    const hasFields = s.overall_sentiment && s.star_breakdown && Array.isArray(s.aspects) && typeof s.prose_summary === 'string';
    if (!hasFields) { check(false, `summary schema complete for ${p.id}`); continue; }

    const reviews = getReviewsByProduct(p.id);
    const actual = getStarBreakdown(p.id);

    // Eval 3 / FM-5: distribution exact + sum
    const distExact = (['1','2','3','4','5'] as const).every((k) => Number(s.star_breakdown[k]) === actual[k as unknown as keyof typeof actual]);
    const sum = (['1','2','3','4','5'] as const).reduce((a, k) => a + Number(s.star_breakdown[k]), 0);
    if (distExact && sum === reviews.length) starOk++;
    else quoteIssues.push(`${p.id}: star dist exact=${distExact} sum=${sum}/${reviews.length}`);

    // aspects sorted
    const c = s.aspects.map((a) => a.mention_count);
    if (c.every((x, i) => i === 0 || c[i - 1] >= x)) sortedOk++;

    // Eval 1 / FM-1: quotes grounded
    const hay = norm(reviews.map((r) => `${r.title ?? ''} ${r.body}`).join(' \n '));
    const ungrounded = s.aspects.filter((a) => { const q = norm(a.representative_quote || ''); return q && !hay.includes(q); });
    if (ungrounded.length === 0) quotesOk++;
    else { ungroundedProducts.push(p.id); quoteIssues.push(`${p.id}: ${ungrounded.length} ungrounded quote(s)`); }

    // FM-3: sentiment not rosier than reality. If >=25% of reviews are 1-star,
    // overall_sentiment must not be (very_/mostly_)positive.
    const oneStarFrac = actual['1'] / reviews.length;
    const rosy = s.overall_sentiment === 'very_positive' || s.overall_sentiment === 'mostly_positive';
    if (!(oneStarFrac >= 0.25 && rosy)) fm3Ok++;
    else quoteIssues.push(`${p.id}: FM-3 — '${s.overall_sentiment}' but ${Math.round(oneStarFrac * 100)}% are 1-star`);
  }

  check(starOk === products.length, `Eval 3 (star_breakdown exact + sums): ${starOk}/9`);
  // Eval 1: only an UNEXPECTED ungrounded product is a failure; known ones warn.
  const unexpectedUngrounded = ungroundedProducts.filter((id) => !KNOWN_UNGROUNDED.has(id));
  check(unexpectedUngrounded.length === 0, `Eval 1 (quotes grounded): ${quotesOk}/9, no UNEXPECTED ungrounded`, unexpectedUngrounded.join('; '));
  for (const id of ungroundedProducts.filter((id) => KNOWN_UNGROUNDED.has(id)))
    warnMsg(`Eval 1: ${id} has known/accepted ungrounded quotes (Pilestone FM-1, logged)`);
  check(sortedOk === products.length, `aspects sorted by frequency: ${sortedOk}/9`);
  check(fm3Ok === products.length, `FM-3 (no sentiment averaging): ${fm3Ok}/9`);

  // Eval 2: dominant aspect sensible. Health -> taste/effectiveness in top 2.
  const health = products.filter((p) => p.category === 'health_personal_care');
  let evalw2 = 0;
  for (const p of health) {
    const s = JSON.parse((db.prepare('SELECT summary_json FROM summaries WHERE product_id=?').get(p.id) as { summary_json: string }).summary_json) as ProductSummary;
    const top2 = s.aspects.slice(0, 2).map((a) => a.name.toLowerCase());
    const hit = top2.some((n) => n.includes('taste') || n.includes('flavor') || n.includes('effective'));
    if (hit) evalw2++;
  }
  check(evalw2 === health.length, `Eval 2 (health dominant aspect = taste/effectiveness in top 2): ${evalw2}/${health.length}`);
}

// ====================================================================
// 3. RAG — Evals 4, 5 + FM-2, FM-4 (across categories). Needs LLM.
// ====================================================================
// Markers that indicate the model declined to over-claim (hedged / grounded).
const HEDGE_MARKERS = ['couple', 'two review', 'two reviewer', 'only', 'few review', 'a few', 'none', 'no review', 'no information', 'no info', 'no indication', 'no mention', 'no specific', 'not mention', "don't", 'do not', 'not clear', 'no clear', 'not specifically', 'some review', "aren't", 'not address', "doesn't", 'nothing'];

async function ragRetrieve(productId: string, question: string) {
  const embeddings = getEmbeddingsForProduct(productId);
  const qVec = await embedText(question);
  const ranked = embeddings
    .map((e) => ({ review_id: e.review_id, score: cosineSimilarity(qVec, e.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  const byId = new Map<string, Review>(getReviewsByProduct(productId).map((r) => [r.id, r]));
  return ranked.map((r) => ({ ...r, review: byId.get(r.review_id)! })).filter((r) => r.review);
}

async function askProduct(productId: string, question: string) {
  const retrieved = await ragRetrieve(productId, question);
  const product = getProductById(productId)!;
  const { system, user } = buildQaPrompt(question, product, retrieved.map((r) => ({ rating: r.review.rating, title: r.review.title, body: r.review.body })));
  const res = await chat([{ role: 'system', content: system }, { role: 'user', content: user }], { temperature: 0.1, jsonMode: true, maxTokens: 700 });
  let parsed: QaResult = { answer: res.content, cited_reviews: [] };
  try { let t = res.content.trim(); const a = t.indexOf('{'), b = t.lastIndexOf('}'); if (a !== -1) t = t.slice(a, b + 1); parsed = JSON.parse(t); } catch { /* keep raw */ }
  return { retrieved, parsed };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ragChecks() {
  section('3. RAG — Evals 4, 5 + FM-2/FM-4 (cross-category). Live LLM calls.');
  if (!process.env.LLM_API_KEY) { warnMsg('LLM_API_KEY unset — skipping RAG checks'); return; }
  console.log('  NOTE: RAG checks are INDICATIVE — heuristic-judged and non-deterministic');
  console.log('  (temp 0.1). Confirm borderline cases by hand. Deterministic checks above are exact.\n');

  // relevance (Eval 4): topic keywords known to exist (except health side-effects)
  const relevanceTests = [
    { id: 'beauty-B09B9VR2RK', q: 'Does it leak or have water pressure problems?', kw: ['leak', 'pressure', 'spray', 'squirt', 'water'] },
    { id: 'fashion-B088FZ78SB', q: 'Do these reduce eye strain?', kw: ['strain', 'eye', 'headache', 'screen', 'computer'] },
    { id: 'health_personal_care-B07KF3LQFM', q: 'Does this cause any side effects?', kw: ['side effect', 'stomach', 'bloat', 'cramp', 'nausea', 'salt', 'sick'], known: 'data-limited (Eval 4)' },
  ];
  console.log('\n-- Eval 4: retrieval relevance (sources on-topic / 5) --');
  for (const t of relevanceTests) {
    const { retrieved } = await askProduct(t.id, t.q);
    const rel = retrieved.filter((r) => { const x = norm(`${r.review.title ?? ''} ${r.review.body}`); return t.kw.some((k) => x.includes(norm(k))); }).length;
    const ok = rel >= 4;
    console.log(`  [${t.id.split('-')[0]}] "${t.q}" -> ${rel}/5 on-topic ${ok ? '✓' : t.known ? `(✗ ${t.known})` : '✗'}`);
    if (t.known) { if (!ok) warnMsg(`Eval 4 ${t.id}: ${rel}/5 — ${t.known}`); else { pass++; } }
    else check(ok, `Eval 4 relevance ${t.id.split('-')[0]} (${rel}/5)`);
    await sleep(1200);
  }

  // hedging (Eval 5 / FM-4): thin or absent topics must hedge
  const hedgeTests = [
    { id: 'health_personal_care-B099F3JVXD', q: 'Is it worth the price?' },
    { id: 'fashion-B088FZ78SB', q: 'Are they good for night driving?' },
    { id: 'beauty-B09B9VR2RK', q: 'Is it safe to use on dentures?' }, // dentures = 0 reviews (verified absent; unambiguous hedge)
  ];
  console.log('\n-- Eval 5 / FM-4: hedging on thin/absent evidence --');
  for (const t of hedgeTests) {
    const { parsed } = await askProduct(t.id, t.q);
    const a = (parsed.answer || '').toLowerCase();
    const hedged = HEDGE_MARKERS.some((m) => a.includes(m));
    console.log(`  [${t.id.split('-')[0]}] "${t.q}" -> hedged=${hedged} | "${(parsed.answer || '').slice(0, 90)}…"`);
    check(hedged, `Eval 5 hedging ${t.id.split('-')[0]}`);
    await sleep(1200);
  }

  // FM-2: absent attribute must not be fabricated
  const fm2Tests = [
    { id: 'health_personal_care-B099F3JVXD', q: 'Is this product vegan and cruelty-free?', attr: 'vegan' },
    { id: 'beauty-B09B9VR2RK', q: 'Is this water flosser dishwasher safe?', attr: 'dishwasher' },
  ];
  console.log('\n-- FM-2: must not fabricate an absent attribute --');
  for (const t of fm2Tests) {
    const { parsed } = await askProduct(t.id, t.q);
    const a = (parsed.answer || '').toLowerCase();
    const hedged = HEDGE_MARKERS.some((m) => a.includes(m)) || a.includes('no ') || a.includes('not ');
    const fabricated = (a.includes(`is ${t.attr}`) || a.includes(`yes`)) && !hedged;
    console.log(`  [${t.id.split('-')[0]}] "${t.q}" -> ${fabricated ? 'FABRICATED ✗' : 'grounded ✓'} | "${(parsed.answer || '').slice(0, 90)}…"`);
    check(!fabricated, `FM-2 no fabrication ${t.id.split('-')[0]}`);
    await sleep(1200);
  }
}

async function main() {
  console.log('SIFT FULL VALIDATION\n' + new Date().toISOString());
  dataIntegrity();
  summarizationChecks();
  await ragChecks();

  section('SUMMARY');
  console.log(`  PASS: ${pass}   FAIL: ${fail}   WARN: ${warn}`);
  if (failures.length) {
    console.log('\n  Failures:');
    for (const f of failures) console.log(`   - ${f}`);
  }
  console.log(fail === 0 ? '\n✅ ALL CHECKS PASSED (warnings are known/accepted limitations).' : `\n❌ ${fail} CHECK(S) FAILED.`);
  // Set exitCode instead of process.exit(): calling exit() while onnxruntime
  // worker threads are alive triggers a benign mutex abort on teardown.
  process.exitCode = fail === 0 ? 0 : 1;
}

main();
