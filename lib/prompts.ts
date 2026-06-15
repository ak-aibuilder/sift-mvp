// Prompt templates + output schema for summarization and RAG Q&A.
//
// Each summarization constraint maps to a predicted failure mode (build spec §3):
//   FM-1 fabricated quotes   -> quotes must be copied verbatim from input
//   FM-2 aspect hallucination -> only aspects reviewers actually discuss
//   FM-3 sentiment averaging  -> surface bimodal splits, don't blend
//   FM-5 star math            -> star_breakdown must sum to the review count
//
// Decision: star_breakdown is model-generated (not computed) so Eval 3 genuinely
// tests the model (FM-5). generate-summaries.ts validates the sum and flags
// mismatches for the behavior log rather than silently overwriting.

import type { Category, Review } from './db';

// -- Summary output schema (matches the GET /summary API contract) --

export type OverallSentiment =
  | 'very_positive'
  | 'mostly_positive'
  | 'mixed'
  | 'mostly_negative'
  | 'very_negative';

export type AspectSentiment = 'positive' | 'mixed' | 'negative';

export interface Aspect {
  name: string;
  sentiment: AspectSentiment;
  mention_count: number;
  representative_quote: string;
}

export interface ProductSummary {
  overall_sentiment: OverallSentiment;
  star_breakdown: { '1': number; '2': number; '3': number; '4': number; '5': number };
  aspects: Aspect[];
  prose_summary: string;
}

// -- Category-specific aspect guidance (hints only; reviewers' actual topics win) --

const CATEGORY_ASPECTS: Record<Category, string> = {
  fashion:
    'fit / sizing (does it run true to size?), material and build quality, comfort, ' +
    'color accuracy vs. photos, durability, value for money',
  health_personal_care:
    'effectiveness / results, taste or flavor, side effects and tolerability ' +
    '(stomach issues, reactions), ease of use (e.g. swallowing, mixing), value',
  beauty:
    'effectiveness / results, ease of use, value for money, scent, skin reaction or ' +
    'irritation, packaging and quality',
};

const CATEGORY_LABEL: Record<Category, string> = {
  fashion: 'fashion',
  health_personal_care: 'health & personal care',
  beauty: 'beauty',
};

// -- Summarization prompt --

const SUMMARY_SYSTEM = `You are a meticulous product-review analyst. You summarize a set of real customer reviews into a single structured JSON object. You never invent information.

Hard rules:
1. QUOTES ARE REAL. Every "representative_quote" MUST be copied word-for-word from the text of one of the provided reviews. Never paraphrase, polish, or invent a quote. If you cannot find a real sentence for an aspect, do not include that aspect.
2. ASPECTS ARE GROUNDED. Only extract aspects that reviewers actually discuss in the provided reviews. Do NOT infer plausible product attributes from general knowledge (e.g. do not claim "gluten-free" unless a reviewer mentions it).
3. DO NOT AVERAGE AWAY CONFLICT. If reviews are split (e.g. many 5-star and many 1-star), the summary and overall_sentiment must reflect that split. Set an aspect's sentiment to "mixed" when opinions genuinely diverge. Never flatten a bimodal product into "generally positive".
4. ORDER BY FREQUENCY. The "aspects" array must be sorted by "mention_count" in descending order. "mention_count" is the number of reviews that discuss that aspect.
5. STAR MATH MUST BE EXACT. "star_breakdown" gives the count of reviews at each star level 5..1, and these five numbers MUST sum to exactly the total number of reviews provided.

Output: a single valid JSON object, and nothing else (no markdown, no commentary).`;

function summarySchemaBlock(): string {
  return `JSON shape (use these exact keys):
{
  "overall_sentiment": one of "very_positive" | "mostly_positive" | "mixed" | "mostly_negative" | "very_negative",
  "star_breakdown": { "5": int, "4": int, "3": int, "2": int, "1": int },
  "aspects": [
    { "name": string, "sentiment": "positive" | "mixed" | "negative", "mention_count": int, "representative_quote": string }
  ],
  "prose_summary": string  // 2-4 sentences; mention the split explicitly if the product is divisive
}`;
}

function formatReviewsForPrompt(reviews: Review[], maxBodyChars = 600): string {
  return reviews
    .map((r, i) => {
      const body = r.body.length > maxBodyChars ? r.body.slice(0, maxBodyChars) + '…' : r.body;
      const title = r.title ? ` — "${r.title}"` : '';
      return `[#${i + 1}] (${r.rating}★)${title}\n${body}`;
    })
    .join('\n\n');
}

export function buildSummaryPrompt(
  product: { name: string; category: Category; review_count: number | null },
  reviews: Review[]
): { system: string; user: string } {
  const n = reviews.length;
  const cat = product.category;
  const user = `Product: ${product.name}
Category: ${CATEGORY_LABEL[cat]}
Total reviews provided: ${n}

Common aspects shoppers care about in ${CATEGORY_LABEL[cat]} (only use the ones actually discussed below): ${CATEGORY_ASPECTS[cat]}.

${summarySchemaBlock()}

Remember: star_breakdown must sum to exactly ${n}. Quotes must be copied verbatim from the reviews below.

Reviews:
${formatReviewsForPrompt(reviews)}

Respond with the JSON object only.`;
  return { system: SUMMARY_SYSTEM, user };
}
