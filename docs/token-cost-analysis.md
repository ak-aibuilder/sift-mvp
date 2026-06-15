# Token Cost & Capex Analysis

Two separate cost stories, measured from real data (2026-06-15):

1. **Development cost** — what it cost to *build* Sift with Claude Code (Opus 4.8).
2. **Application inference cost** — what it costs to *run* Sift (Llama 3.1 8B via Groq
   for generation, local embeddings).

> **Pricing note.** Anthropic rates are from the bundled `claude-api` reference
> (cached 2026-06-04). Groq and OpenAI rates are commonly-published list prices used
> for comparison and are **approximate** — verify against each provider before relying
> on them. Provider pricing changes frequently.

---

## Part 1 — Development cost (building Sift with Claude Code)

Measured from the Claude Code session transcript: **791 assistant turns**, model
`claude-opus-4-8`, one continuous build session (Phases 0–5 + extras).

### Tokens

| Category | Tokens | Cost @ Opus 4.8 list |
|---|---:|---:|
| Uncached input | 70,665 | $0.35 |
| Cache writes (1.25×) | 3,838,973 | $23.99 |
| Output (generated) | 1,115,624 | $27.89 |
| Cache reads (0.1×) | 236,000,092 | $118.00 |
| **Total processed** | **241,025,354** | **≈ $170** |

Opus 4.8 list prices: input $5/M, output $25/M, cache write $6.25/M (5-min TTL),
cache read $0.50/M. (1-hour-TTL cache writes would be 2× → total ≈ $185.)

### Reading the numbers
- **~241M tokens processed**, but 236M (98%) are **cache reads** — the same growing
  context re-read on each of 791 turns. Real compute, but it double-counts context.
- **~5.0M genuinely new tokens** (input + cache writes + output) is the better measure
  of the build's "size."
- **Prompt caching saved ~$1,060**: those 236M cache-read tokens would have cost
  $1,180 as fresh input; at the cache-read rate they cost $118 (an ~86% reduction).

### The capex caveat that matters most
The **~$170 is the API-list-price equivalent (notional capex)** — what the build would
cost metered through the API. If it was built on a **Claude Code Max/Pro subscription**
(flat monthly fee), the *marginal* cash cost was effectively **$0** — the tokens are
covered by the plan. For the actual billed figure, run `/cost` in Claude Code or check
the Anthropic Console.

**Bottom line:** ~5M tokens of real work (241M processed with caching). Notional
**~$170** at API rates; likely **$0 marginal** on a subscription.

---

## Part 2 — Application inference cost (running Sift)

Sift makes LLM calls in two places, plus local embeddings:
- **Build-time:** one summary per product (pre-baked, 9 calls total).
- **Runtime:** one LLM call per Q&A question.
- **Embeddings:** local `all-MiniLM-L6-v2` — **no API, $0**.

**Actual provider: Groq free tier → $0.** The tables below price the *measured* token
volume at paid rates for context.

### Reference rates (per 1M tokens)

| Provider / model | Input | Output | Notes |
|---|---:|---:|---|
| **Groq — Llama 3.1 8B (free tier)** | **$0** | **$0** | what Sift actually uses (rate-limited) |
| Groq — Llama 3.1 8B (paid) | $0.05 | $0.08 | same model, paid tier |
| OpenAI — GPT-4o-mini | $0.15 | $0.60 | nearest small model |
| Anthropic — Claude Haiku 4.5 | $1.00 | $5.00 | nearest small model (authoritative) |

### Build-time costs — summarization (9 products, one-time)

Measured from the `summaries` table: **26,586 input / 4,037 output** tokens total.

| Provider | Cost (all 9) |
|---|---:|
| **Groq free tier** | **$0.00** |
| Groq paid | $0.0016 |
| OpenAI GPT-4o-mini | $0.0064 |
| Anthropic Haiku 4.5 | $0.0468 |

Per product: **2,954 input / 449 output** (avg), ≈ 72.8 input tokens per review.

### Runtime costs — Q&A (per query)

Measured from a live 10-query sample across all categories: **avg 798 input / 45
output** (range 662–953 in, 32–58 out). The input is dominated by the 5 retrieved
review excerpts + prompt; output is short and grounded.

| Provider | Per query | Per 1,000 queries | Per 10,000 queries |
|---|---:|---:|---:|
| **Groq free tier** | **$0.000000** | **$0.00** | **$0.00** |
| Groq paid | $0.000044 | $0.044 | $0.44 |
| OpenAI GPT-4o-mini | $0.000147 | $0.147 | $1.47 |
| Anthropic Haiku 4.5 | $0.001023 | $1.02 | $10.23 |

### Embedding costs

**$0.** Embeddings run locally via `@huggingface/transformers` (all-MiniLM-L6-v2):
- One-time: 365 review embeddings baked into `sift.db`.
- Runtime: each question is embedded locally before retrieval.

No API calls, no per-token charge — only local CPU time (and a one-time ~25MB model
download, cached into the Docker image).

### Total cost summary

| Component | Tokens | Groq free | Groq paid | OpenAI | Anthropic |
|---|---|---:|---:|---:|---:|
| Build-time summaries (9) | 30,623 | **$0** | $0.0016 | $0.0064 | $0.047 |
| Embeddings (local) | — | **$0** | $0 | $0 | $0 |
| **Build total (one-time)** | | **$0** | **$0.0016** | **$0.0064** | **$0.047** |
| Runtime per 1k Q&A | ~843k | **$0** | $0.044 | $0.147 | $1.02 |

**At current scale, Sift's all-in inference cost is $0** (Groq free tier + local
embeddings). Even at paid Groq rates, building all 9 summaries costs ~⅙ of a cent and
1,000 user questions cost ~4 cents.

---

## Provider comparison (why the spread matters)

For the same measured token volume, the cheapest paid option (Groq 8B) is **~23× cheaper
than Anthropic Haiku** and **~3.3× cheaper than OpenAI 4o-mini** on Q&A. This is the
core economic bet in the build spec: a small model (Llama 3.1 8B) on a cheap, fast host
(Groq) for browsing-scale workloads, with the OpenAI-compatible client making the
provider a 3-env-var swap if the economics or quality change.

The trade-off is quality — the small model's documented failure modes (star-breakdown
fabrication, FM-4 over-counting; see `model-behavior-log.md`) are part of the price of
the cheap tier. Sift engineers around them (deterministic star math, prompt hardening)
rather than paying for a larger model.

---

## Token efficiency & scale

**Per-summary shape:** 2,954 input / 449 output, a **~6.6:1 input:output ratio** —
expected for summarization (read a lot, write a little). Input scales with review
volume (~73 tokens/review); output is bounded by the fixed summary schema (~450 tokens
regardless of product).

**Summarization cost at scale** (one-time, linear in product count):

| Scale | Input | Output | Groq free | Groq paid | OpenAI | Anthropic |
|---|---:|---:|---:|---:|---:|---:|
| 9 (today) | 0.03M | 0.004M | $0 | $0.002 | $0.01 | $0.05 |
| 1,000 | 2.95M | 0.45M | **$0** | $0.18 | $0.71 | $5.20 |
| 10,000 | 29.5M | 4.49M | **$0** | $1.84 | $7.12 | $51.97 |

**What this implies:**
- **Summarization is cheap and one-time.** Even 10,000 products is **<$2 on Groq paid**,
  ~$7 on OpenAI, ~$52 on Anthropic Haiku — a fixed, pre-deploy cost, not a recurring one.
- **Runtime cost scales with *questions*, not products.** The lever at scale is Q&A
  volume. At 10k products with, say, 100k questions/month: Groq paid ≈ **$4.40/month**,
  OpenAI ≈ $14.70, Anthropic Haiku ≈ $102. Groq free tier stays $0 but its rate limits
  would bind well before that volume — the realistic scale path is Groq paid.
- **Embeddings stay $0 in API terms** at any scale, but local embedding compute (and
  the vector search) becomes the bottleneck long before cost does — at large catalogs
  you'd move from in-process cosine over SQLite blobs to a real vector index.
- **Caching would help at scale.** Q&A input is dominated by the prompt + retrieved
  reviews; with a larger paid model, prompt caching of the system prompt would cut the
  input bill materially (it's why the dev-time Claude Code cost was 86% caching savings).

---

## Methodology & reproduce

- **Dev tokens:** summed `message.usage` across the session transcript JSONL
  (input/output/cache-creation/cache-read).
- **Build-time app tokens:** `SELECT prompt_tokens, completion_tokens FROM summaries`.
- **Runtime app tokens:** 10 live Q&A calls to the deployed `/ask` endpoint, averaging
  the `usage` field each returns (the same `[token_usage]` data logged to Railway).
- **Embeddings:** $0 by construction (local model).

```sql
-- build-time summarization tokens
SELECT SUM(prompt_tokens) AS in_tok, SUM(completion_tokens) AS out_tok FROM summaries;
```

All figures are list-price estimates for context; Groq/OpenAI rates are approximate and
should be re-checked. Anthropic Haiku rates are from the `claude-api` skill reference
(cached 2026-06-04).
