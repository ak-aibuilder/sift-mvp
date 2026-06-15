import { NextResponse } from 'next/server';
import {
  getProductById,
  getReviewsByProduct,
  getEmbeddingsForProduct,
  type Review,
} from '@/lib/db';
import { embedText, cosineSimilarity } from '@/lib/embeddings';
import { buildQaPrompt, type QaResult } from '@/lib/prompts';
import { chat } from '@/lib/llm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Decision: top-5 retrieval, not top-10 — the LLM context fills fast at 30-60
// reviews and the extra recall isn't worth the noise for a focused question.
const TOP_K = 5;

function safeParse(raw: string): QaResult {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a !== -1 && b !== -1) s = s.slice(a, b + 1);
  return JSON.parse(s) as QaResult;
}

// POST /api/products/[id]/ask  { question: string }
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const product = getProductById(id);
  if (!product) {
    return NextResponse.json({ error: 'Product not found' }, { status: 404 });
  }

  let question = '';
  try {
    question = (await req.json())?.question ?? '';
  } catch {
    /* invalid body handled below */
  }
  if (typeof question !== 'string' || question.trim().length === 0) {
    return NextResponse.json({ error: 'A non-empty "question" is required.' }, { status: 400 });
  }

  const embeddings = getEmbeddingsForProduct(id);
  if (embeddings.length === 0) {
    return NextResponse.json(
      { error: 'No embeddings for this product. Run: npm run generate:embeddings' },
      { status: 404 }
    );
  }

  // Retrieve: embed the question, rank reviews by cosine similarity, take top-K.
  const qVec = await embedText(question);
  const ranked = embeddings
    .map((e) => ({ review_id: e.review_id, score: cosineSimilarity(qVec, e.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_K);

  const reviewById = new Map<string, Review>(
    getReviewsByProduct(id).map((r) => [r.id, r])
  );
  const retrieved = ranked
    .map((r) => ({ ...r, review: reviewById.get(r.review_id) }))
    .filter((r): r is typeof r & { review: Review } => Boolean(r.review));

  // Generate a grounded answer from only the retrieved reviews.
  const { system, user } = buildQaPrompt(
    question,
    product,
    retrieved.map((r) => ({
      rating: r.review.rating,
      title: r.review.title,
      body: r.review.body,
    }))
  );

  let parsed: QaResult;
  let usage = {
    prompt_tokens: null as number | null,
    completion_tokens: null as number | null,
    total_tokens: 0,
  };
  let modelUsed = '';
  try {
    const res = await chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      { temperature: 0.1, jsonMode: true, maxTokens: 700 }
    );
    parsed = safeParse(res.content);
    modelUsed = res.model;
    usage = {
      prompt_tokens: res.prompt_tokens,
      completion_tokens: res.completion_tokens,
      total_tokens: (res.prompt_tokens ?? 0) + (res.completion_tokens ?? 0),
    };
  } catch (e) {
    const err = e as { message?: string };
    return NextResponse.json(
      { error: `Answer generation failed: ${err.message ?? e}` },
      { status: 502 }
    );
  }

  // Sources = the retrieved reviews shown to the model (Eval 4 checks these 5).
  const sources = retrieved.map((r) => ({
    review_id: r.review_id,
    excerpt: r.review.body.length > 240 ? r.review.body.slice(0, 240) + '…' : r.review.body,
    rating: r.review.rating,
    relevance_score: Math.round(r.score * 100) / 100,
  }));

  const cited = Array.isArray(parsed.cited_reviews)
    ? parsed.cited_reviews.filter((n) => Number.isInteger(n) && n >= 1 && n <= retrieved.length)
    : [];

  // Structured token-usage log line. Railway captures stdout — search "token_usage"
  // in the service logs to find/troubleshoot high-usage operations.
  console.log(
    `[token_usage] ${JSON.stringify({
      op: 'qa',
      product_id: id,
      model: modelUsed,
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      total_tokens: usage.total_tokens,
      sources: sources.length,
      question: question.slice(0, 200),
    })}`
  );

  return NextResponse.json({
    answer: parsed.answer ?? '',
    sources,
    reviews_searched: embeddings.length,
    reviews_cited: new Set(cited).size,
    usage,
  });
}
