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

### 2026-06-14 — FM-4 NOT observed (good): proportional hedging on thin/absent evidence
- **Phase/Step:** Phase 3, Step 16 (RAG Q&A, ask route)
- **FM:** FM-4 (over-generalization from thin evidence) — predicted, did not occur
- **What happened:** The Q&A model hedged correctly every time:
  - "Does this cause side effects?" (Hi-Lyte) → "Only a couple of reviews mention
    potential side effects, specifically feeling bloated."
  - "Is it worth the price?" (Dentitox, price in only 2 reviews) → "...none
    specifically comment on whether it's worth the price." (no broad claim invented)
- **Fix / response:** None. Eval 5 passes. The "stay proportional / say when evidence
  is thin" rules in QA_SYSTEM are working.

### 2026-06-14 — FM-2 NOT observed (good): refused to fabricate an absent attribute
- **Phase/Step:** Phase 3, Step 16
- **FM:** FM-2 (aspect/attribute hallucination) — predicted, did not occur
- **What happened:** "Is this product vegan and cruelty-free?" (Dentitox; no review
  mentions it) → "There is no clear indication that this product is vegan and
  cruelty-free." cited_reviews=0. The model did not infer a plausible attribute from
  training data — exactly the FM-2 trap, avoided.
- **Fix / response:** None.

### 2026-06-15 — FM-4 (mild watch-item): "multiple reviewers" on borderline-thin evidence
- **Phase/Step:** Validation harness (pre-Phase 4), `npm run validate`
- **Product:** beauty-B09B9VR2RK (Cordless Water Flosser)
- **FM:** FM-4 (over-generalization) — mild, non-deterministic
- **What happened:** Asked "Is it gentle on sensitive teeth?" — only 1 review
  explicitly says "sensitive teeth" ("Works great on sensitive teeth and gums"),
  plus a few tangential gentleness/adjustability reviews. The model answered "gentle
  on sensitive teeth, according to multiple reviewers." Across runs it varied between
  "Four reviewers…" and "multiple reviewers" (cited 2) — temp 0.1 is not deterministic.
- **Assessment:** NOT a fabrication — it cited a genuinely supporting review. But it
  overstates the *specific* "sensitive teeth" evidence (1 review) as "multiple". A
  stricter answer would say "one reviewer specifically mentions sensitive teeth."
- **Fix attempted (2026-06-15):** Strengthened QA_SYSTEM rule 2 to "COUNT ONLY
  EXPLICIT MENTIONS", with the exact example that "gentle on gums" does NOT count as
  addressing "sensitive teeth", and "if exactly one review explicitly addresses the
  topic, say 'one reviewer' — never 'multiple reviewers'."
- **Outcome:** PARTIAL. The instruction measurably sharpened the unambiguous cases:
  "slippery on floors" now → "Only one reviewer… no review directly addresses floors";
  "true to size" now itemizes one/another reviewer. Controls did not over-correct
  ("easy to use" still "all 5 reviewers"). BUT the sensitive-teeth case STILL returns
  "multiple reviewers" across runs — the model read the explicit instruction and still
  counts gum-gentleness reviews as on-topic.
- **Reclassification:** This is a robust MODEL LIMITATION on semantically-overlapping
  topics (gums ≈ sensitive teeth), not a promptable defect within reasonable effort.
  Notable in itself: the model resisted an explicit, example-backed instruction.
  Arguably semantically defensible (gum-gentleness IS related evidence). Heavier
  levers (retrieval similarity threshold, second-pass LLM verification) were rejected:
  a threshold (~0.5) would starve legitimately-thin topics like the health
  side-effects question (scores 0.28–0.33) and hurt Eval 4/5 there. Accepted as a
  documented limitation; the improved prompt ships. Capability-bet territory per
  spec Risk 5 (don't exceed ~1hr of prompt engineering).
- **Full writeup with illustrations:** docs/rag-overcounting-explainer.md.

### 2026-06-14 — Eval 4 limitation: dataset lacks side-effect reviews (not a retrieval bug)
- **Phase/Step:** Phase 3, Step 16
- **FM:** n/a — data limitation, flagged since docs/dataset-readiness.md
- **What happened:** Eval 4 ("Does this cause side effects?" → 4/5 retrieved sources
  on-topic) FAILS: only 1/5 sources genuinely discuss a side effect. Root cause
  verified: Hi-Lyte (best candidate) has only ~1 review describing a true adverse
  effect ("bloated"); the other side-effect-term matches are about the product
  RELIEVING cramps (effectiveness) or salt content. Retrieval scores are low
  (0.28–0.33), confirming weak matches because the content isn't there. Retrieval and
  answer-grounding both work correctly; the dataset simply lacks adverse-event reviews.
- **Fix / response:** Accepted as a known gap (checkpoint passes 1/2 via Eval 5). No
  prompt/threshold change can manufacture missing reviews. To make Eval 4 pass would
  require re-curating to a product with genuine adverse-event reviews (e.g. a
  supplement with many "upset stomach" complaints) — deferred; not worth re-curation
  at this stage.
