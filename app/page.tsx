import Link from "next/link";
import { getAllProducts } from "@/lib/db";
import { CATEGORY_LABELS, CATEGORY_BADGE } from "@/lib/display";

// Decision: server components read SQLite directly (no internal HTTP hop). The
// /api routes stay for the interactive Q&A and any external consumers.
export const dynamic = "force-dynamic";

function Stars({ rating }: { rating: number }) {
  const full = Math.round(rating);
  return (
    <span className="text-amber-500" aria-label={`${rating} out of 5 stars`}>
      {"★".repeat(full)}
      <span className="text-zinc-300">{"★".repeat(5 - full)}</span>
    </span>
  );
}

export default function Home() {
  const products = getAllProducts();

  return (
    <div>
      <section className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          Know what buyers think — without reading every review
        </h1>
        <p className="mt-2 max-w-2xl text-zinc-600">
          Pick a product to see a structured summary of its reviews, then ask your own
          question and get an answer grounded in what real customers wrote.
        </p>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {products.map((p) => (
          <Link
            key={p.id}
            href={`/products/${p.id}`}
            className="group flex flex-col rounded-xl border border-zinc-200 bg-white p-5 transition hover:border-zinc-300 hover:shadow-sm"
          >
            <span
              className={`mb-3 w-fit rounded-full px-2.5 py-1 text-xs font-medium ${CATEGORY_BADGE[p.category]}`}
            >
              {CATEGORY_LABELS[p.category]}
            </span>
            <h2 className="line-clamp-3 flex-1 font-medium leading-snug text-zinc-900 group-hover:text-zinc-700">
              {p.name}
            </h2>
            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="flex items-center gap-1.5">
                <Stars rating={p.avg_rating ?? 0} />
                <span className="font-medium text-zinc-700">
                  {p.avg_rating?.toFixed(1) ?? "—"}
                </span>
              </span>
              <span className="text-zinc-500">{p.review_count} reviews</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
