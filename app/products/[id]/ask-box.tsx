"use client";

import { useState } from "react";

interface Source {
  review_id: string;
  excerpt: string;
  rating: number;
  relevance_score: number;
}
interface AskResponse {
  answer: string;
  sources: Source[];
  reviews_searched: number;
  reviews_cited: number;
}

const EXAMPLES = [
  "What do people complain about?",
  "Is it easy to use?",
  "Is it worth the price?",
];

export function AskBox({ productId }: { productId: string }) {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AskResponse | null>(null);

  async function ask(q: string) {
    const trimmed = q.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch(`/api/products/${productId}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Something went wrong.");
      setResult(data as AskResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(question);
        }}
        className="flex gap-2"
      >
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. Does this cause any side effects?"
          className="flex-1 rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm outline-none placeholder:text-zinc-400 focus:border-zinc-500"
        />
        <button
          type="submit"
          disabled={loading || !question.trim()}
          className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:opacity-40"
        >
          {loading ? "Thinking…" : "Ask"}
        </button>
      </form>

      {/* Example chips */}
      <div className="mt-2 flex flex-wrap gap-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            disabled={loading}
            onClick={() => {
              setQuestion(ex);
              ask(ex);
            }}
            className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs text-zinc-600 transition hover:border-zinc-300 hover:text-zinc-900 disabled:opacity-40"
          >
            {ex}
          </button>
        ))}
      </div>

      {error && (
        <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {error}
        </p>
      )}

      {loading && (
        <div className="mt-4 animate-pulse rounded-xl border border-zinc-200 bg-white p-5">
          <div className="h-3 w-3/4 rounded bg-zinc-100" />
          <div className="mt-2 h-3 w-1/2 rounded bg-zinc-100" />
        </div>
      )}

      {result && !loading && (
        <div className="mt-4 space-y-4">
          <div className="rounded-xl border border-zinc-200 bg-white p-5">
            <p className="leading-relaxed text-zinc-800">{result.answer}</p>
            <p className="mt-3 text-xs text-zinc-400">
              Searched {result.reviews_searched} reviews · cited{" "}
              {result.reviews_cited}
            </p>
          </div>

          {result.sources.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-400">
                Sources
              </h3>
              <div className="space-y-2">
                {result.sources.map((s) => (
                  <div
                    key={s.review_id}
                    className="rounded-lg border border-zinc-200 bg-white p-3 text-sm"
                  >
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="text-amber-500">
                        {"★".repeat(s.rating)}
                        <span className="text-zinc-300">
                          {"★".repeat(5 - s.rating)}
                        </span>
                      </span>
                      <span className="text-zinc-400">
                        {(s.relevance_score * 100).toFixed(0)}% match
                      </span>
                    </div>
                    <p className="text-zinc-600">“{s.excerpt}”</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
