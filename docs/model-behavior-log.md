# Model Behavior Log

Real-time log of unexpected model behavior during the Sift build. Add an entry the
moment Llama 3.1 8B (or whichever generation model is configured) does something
surprising — fabrication, malformed JSON, refusal, arithmetic error, etc.

The five predicted failure modes are FM-1…FM-5 (see the build spec §3). Tag entries
with the matching FM when applicable.

| FM | Prediction |
|---|---|
| FM-1 | Fabricated quotes (invents reviewer text) |
| FM-2 | Aspect hallucination (extracts an aspect no reviewer discussed) |
| FM-3 | Sentiment averaging (blends bimodal into "generally positive") |
| FM-4 | Over-generalization in RAG (broad claims from thin evidence) |
| FM-5 | Star-breakdown math errors (numbers don't sum to review count) |

---

## Entry template

```
### YYYY-MM-DD — <short title>
- **Phase/Step:** e.g. Phase 2, Step 8 (generate-summaries)
- **Product:** <product id / name>
- **FM:** FM-? (or "new" if unpredicted)
- **What happened:** <observed behavior>
- **Input/trigger:** <prompt, product, question>
- **Fix / response:** <prompt change, retry, threshold tweak, accepted as known gap>
```

---

## Entries

### 2026-06-14 — FM-5 OBSERVED: model fabricates star distributions (sums right, counts wrong)
- **Phase/Step:** Phase 2, Step 8 (generate-summaries, llama-3.1-8b-instant)
- **FM:** FM-5 (predicted — occurred, in a subtle form)
- **What happened:** Every product's `star_breakdown` **summed** correctly to the
  review count (9/9), so it passes Eval 3 as literally written. BUT the actual
  per-star **counts were wrong on all 9/9 products**, always biased to make the
  product look better: 5-star counts inflated, 1-star counts suppressed. Example
  (Irish Moss, real→model): 5★ 18→23, 1★ 29→22. The model guesses the distribution
  from overall tone instead of counting.
- **Why my first read was wrong:** the initial validator only checked the sum (what
  Eval 3 specifies), which hid the distribution error until I compared against the DB.
- **Fix / response (Option A, approved 2026-06-14):** Compute `star_breakdown`
  deterministically from the reviews table (`getStarBreakdown` in lib/db.ts) and
  override the model's guess; the model's wrong guess is still logged here. Existing
  9 summaries patched in place; generate-summaries.ts does the override + aspect sort
  on every future run. Now 9/9 distributions exact. Full writeup:
  docs/star-breakdown-explainer.md.

### 2026-06-14 — FM-3 NOT observed: bimodal sentiment preserved
- **Phase/Step:** Phase 2, Step 8
- **FM:** FM-3 (predicted, did not occur)
- **What happened:** All 9 products (each deliberately bimodal) returned
  `overall_sentiment: "mixed"` rather than being flattened to "generally positive".
  The explicit "do not average away conflict" rule appears to be working.
- **Fix / response:** None. Eval 2's dominant aspects also land in the top 2 for all
  health products (taste/effectiveness).

### 2026-06-14 — FM-1 (mild): stitched quotes on Pilestone color-blind glasses
- **Phase/Step:** Phase 2, Step 8
- **Product:** fashion-B01N9QS2I9 (Pilestone TP-002 Color Blind Glasses)
- **FM:** FM-1 (fabricated/edited quotes) — mild form
- **What happened:** 2 of 7 `representative_quote`s are not verbatim. Each contains
  a large (18–20 word) verbatim fragment from a real review, but the model prepended
  a short phrase ("He can see red now! " / "They worked... a bit. ") that does not
  appear contiguously, i.e. it stitched/edited. One also attached a color-testing
  quote to the "comfort" aspect (minor aspect/quote mismatch).
- **Input/trigger:** Standard summarization prompt; product has emotionally vivid
  reviews (parents describing a colorblind child seeing red).
- **Fix / response:** Logged. Health products (used for Eval 1) had 0 ungrounded
  quotes, so Eval 1 passes on its designated product. Candidate prompt hardening:
  add "copy ONE contiguous sentence; never join sentences or add ellipses." Deferred
  pending the Phase 2 checkpoint decision (don't over-tune; Risk 5 budget).

### 2026-06-14 — Constraint slip: aspects not fully sorted by mention_count
- **Phase/Step:** Phase 2, Step 8
- **Product:** beauty-B08B81KHK3, fashion-B088FZ78SB, fashion-B0777PFY9C (3 of 9)
- **FM:** new (unpredicted) — instruction-following slip
- **What happened:** The top 1–3 aspects are correctly ordered by `mention_count`,
  but lower-frequency tail aspects are out of order (e.g. counts 13, 7, 5, 4, 2, **4**).
  Does not affect Eval 2 (only cares about the top 2).
- **Fix / response (done 2026-06-14):** generate-summaries.ts now sorts the aspects
  array by `mention_count` deterministically after parsing (no eval depends on the
  model doing the sort). Existing 9 summaries patched. Now 9/9 sorted.
