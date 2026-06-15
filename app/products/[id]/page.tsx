import Link from "next/link";
import { notFound } from "next/navigation";
import { getProductById, getSummary } from "@/lib/db";
import type { ProductSummary } from "@/lib/prompts";
import {
  CATEGORY_LABELS,
  CATEGORY_BADGE,
  OVERALL_LABELS,
  OVERALL_BADGE,
  ASPECT_SENTIMENT,
} from "@/lib/display";
import { AskBox } from "./ask-box";

export const dynamic = "force-dynamic";

function StarBreakdown({
  breakdown,
  total,
}: {
  breakdown: ProductSummary["star_breakdown"];
  total: number;
}) {
  return (
    <div className="space-y-1.5">
      {(["5", "4", "3", "2", "1"] as const).map((star) => {
        const count = Number(breakdown[star]) || 0;
        const pct = total > 0 ? (count / total) * 100 : 0;
        return (
          <div key={star} className="flex items-center gap-3 text-sm">
            <span className="w-8 shrink-0 text-zinc-600">{star} ★</span>
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-zinc-100">
              <div
                className="h-full rounded-full bg-amber-400"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="w-8 shrink-0 text-right tabular-nums text-zinc-500">
              {count}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const product = getProductById(id);
  if (!product) notFound();

  const summaryRow = getSummary(id);
  const summary: ProductSummary | null = summaryRow
    ? (JSON.parse(summaryRow.summary_json) as ProductSummary)
    : null;

  return (
    <div>
      <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-800">
        ← All products
      </Link>

      {/* Header */}
      <div className="mt-3">
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${CATEGORY_BADGE[product.category]}`}
        >
          {CATEGORY_LABELS[product.category]}
        </span>
        <h1 className="mt-3 text-xl font-semibold leading-snug tracking-tight">
          {product.name}
        </h1>
        <div className="mt-2 flex items-center gap-3 text-sm text-zinc-600">
          <span className="text-amber-500">
            {"★".repeat(Math.round(product.avg_rating ?? 0))}
            <span className="text-zinc-300">
              {"★".repeat(5 - Math.round(product.avg_rating ?? 0))}
            </span>
          </span>
          <span className="font-medium text-zinc-800">
            {product.avg_rating?.toFixed(1) ?? "—"}
          </span>
          <span className="text-zinc-400">·</span>
          <span>{product.review_count} reviews</span>
        </div>
      </div>

      {!summary ? (
        <p className="mt-8 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          No summary has been generated for this product yet.
        </p>
      ) : (
        <div className="mt-6 grid gap-6 md:grid-cols-5">
          {/* Left: sentiment + star breakdown */}
          <div className="space-y-5 md:col-span-2">
            <div className="rounded-xl border border-zinc-200 bg-white p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium text-zinc-500">Overall</h2>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${OVERALL_BADGE[summary.overall_sentiment]}`}
                >
                  {OVERALL_LABELS[summary.overall_sentiment]}
                </span>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-zinc-700">
                {summary.prose_summary}
              </p>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white p-5">
              <h2 className="mb-3 text-sm font-medium text-zinc-500">
                Rating breakdown
              </h2>
              <StarBreakdown
                breakdown={summary.star_breakdown}
                total={product.review_count ?? 0}
              />
            </div>
          </div>

          {/* Right: aspects */}
          <div className="md:col-span-3">
            <h2 className="mb-3 text-sm font-medium text-zinc-500">
              What reviewers talk about
            </h2>
            <div className="space-y-3">
              {summary.aspects.map((aspect, i) => {
                const s = ASPECT_SENTIMENT[aspect.sentiment];
                return (
                  <div
                    key={`${aspect.name}-${i}`}
                    className="rounded-xl border border-zinc-200 bg-white p-4"
                  >
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-2 font-medium capitalize text-zinc-900">
                        <span className={`h-2 w-2 rounded-full ${s.dot}`} />
                        {aspect.name}
                      </span>
                      <span className="text-xs text-zinc-500">
                        <span className={s.text}>{s.label}</span> ·{" "}
                        {aspect.mention_count} mentions
                      </span>
                    </div>
                    {aspect.representative_quote && (
                      <blockquote className="mt-2 border-l-2 border-zinc-200 pl-3 text-sm italic text-zinc-600">
                        “{aspect.representative_quote}”
                      </blockquote>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Q&A */}
      <div className="mt-10">
        <h2 className="text-lg font-semibold tracking-tight">
          Ask about this product&apos;s reviews
        </h2>
        <p className="mt-1 text-sm text-zinc-600">
          Answers are grounded only in the {product.review_count} customer reviews —
          with the specific reviews cited.
        </p>
        <AskBox productId={product.id} />
      </div>
    </div>
  );
}
