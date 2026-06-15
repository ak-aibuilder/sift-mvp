// Pre-bake a structured summary for every product into the summaries table.
// Run: npm run generate:summaries   (needs LLM_API_KEY in .env.local)
//
// Decision: 2s delay between calls to stay under Groq free-tier rate limits (Risk 1).
// Decision: summaries are pre-baked at build time; the app never summarizes at
// request time — only RAG Q&A makes live LLM calls.

try {
  process.loadEnvFile('.env.local');
} catch {
  /* defaults apply */
}

import {
  getAllProducts,
  getReviewsByProduct,
  getStarBreakdown,
  upsertSummary,
  type Review,
} from '../lib/db';
import { buildSummaryPrompt, type ProductSummary } from '../lib/prompts';
import { chat, getModel } from '../lib/llm';

const DELAY_MS = 2000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Strip ```json fences if the model wraps its output, then parse.
function parseJsonObject(raw: string): unknown {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start !== -1 && end !== -1) s = s.slice(start, end + 1);
  return JSON.parse(s);
}

// Loose normalization for quote-grounding checks (FM-1 / Eval 1 pre-check).
function norm(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// Quotes the model returned that are NOT a contiguous substring of any real
// review (title or body) — the FM-1 fabrication check.
function ungroundedQuotes(summary: ProductSummary, reviews: Review[]): string[] {
  const haystack = norm(reviews.map((r) => `${r.title ?? ''} ${r.body}`).join(' \n '));
  return (summary.aspects || [])
    .filter((a) => {
      const q = norm(a.representative_quote || '');
      return q.length > 0 && !haystack.includes(q);
    })
    .map((a) => `${a.name}: "${a.representative_quote}"`);
}

// How far the model's star distribution is from ground truth, summed across bins.
function starDistanceFromTruth(
  modelStars: ProductSummary['star_breakdown'],
  actual: ProductSummary['star_breakdown']
): number {
  return (['1', '2', '3', '4', '5'] as const).reduce(
    (s, k) => s + Math.abs((Number(modelStars?.[k]) || 0) - actual[k]),
    0
  );
}

async function main() {
  const products = getAllProducts();
  console.log(`Generating summaries for ${products.length} products with ${getModel()}\n`);

  const issues: string[] = [];

  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    const reviews = getReviewsByProduct(p.id);
    const { system, user } = buildSummaryPrompt(p, reviews);

    process.stdout.write(`[${i + 1}/${products.length}] ${p.name.slice(0, 42)}… `);

    try {
      const res = await chat(
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        { temperature: 0.2, jsonMode: true, maxTokens: 1800 }
      );

      const summary = parseJsonObject(res.content) as ProductSummary;

      // Option A: trust the database, not the model, for star_breakdown. Capture
      // the model's guess for FM-5 logging, then override with ground truth and
      // sort aspects by frequency deterministically (no eval depends on the model
      // doing either). See docs/star-breakdown-explainer.md.
      const actualStars = getStarBreakdown(p.id);
      const starDelta = starDistanceFromTruth(summary.star_breakdown, actualStars);
      summary.star_breakdown = actualStars;
      summary.aspects = [...(summary.aspects || [])].sort(
        (a, b) => b.mention_count - a.mention_count
      );

      const ungrounded = ungroundedQuotes(summary, reviews);

      upsertSummary({
        product_id: p.id,
        summary_json: JSON.stringify(summary),
        model_used: res.model,
        generated_at: new Date().toISOString(),
        prompt_tokens: res.prompt_tokens,
        completion_tokens: res.completion_tokens,
      });

      const topAspects = summary.aspects
        .slice(0, 3)
        .map((a) => `${a.name}(${a.mention_count})`)
        .join(', ');
      console.log(
        `ok — ${summary.overall_sentiment}; aspects: ${topAspects || 'none'}`
      );
      console.log(
        `      star_breakdown=computed from DB` +
          ` ${starDelta === 0 ? '(model matched ✓)' : `(model was off by ${starDelta} across bins — FM-5, fixed)`}` +
          ` | ungrounded_quotes ${ungrounded.length === 0 ? '✓' : `✗ ${ungrounded.length} (FM-1)`}`
      );

      if (starDelta > 0)
        issues.push(
          `${p.id}: model fabricated star_breakdown, off by ${starDelta} across bins (FM-5); stored ground-truth instead`
        );
      for (const q of ungrounded)
        issues.push(`${p.id}: ungrounded quote — ${q} (FM-1)`);
    } catch (e: unknown) {
      const err = e as { status?: number; message?: string };
      console.log(`FAILED — ${err.status ?? ''} ${err.message ?? e}`);
      issues.push(`${p.id}: generation/parse failed — ${err.message ?? e}`);
    }

    if (i < products.length - 1) await sleep(DELAY_MS);
  }

  console.log(`\n${'='.repeat(60)}`);
  if (issues.length === 0) {
    console.log('All summaries generated and passed automated checks.');
  } else {
    console.log(`Generated with ${issues.length} flag(s) to review (log these in docs/model-behavior-log.md):`);
    for (const it of issues) console.log(`  - ${it}`);
  }
  console.log('\nNext: GET /api/products/[id]/summary, then run Evals 1-3 (Step 10).');
}

main();
