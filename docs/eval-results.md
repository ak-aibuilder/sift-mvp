# Eval Results

Pass/fail from manual eval runs. Each eval has an unambiguous pass/fail (see build
spec §4). Record a row per run — re-runs after prompt/threshold changes get new rows
so we keep the history.

- **Evals 1–3** run in Phase 2, Step 10 (against generated summaries).
- **Evals 4–5** run in Phase 3, Step 16 (against the RAG Q&A endpoint).
- **Final run** on the deployed app in Phase 5, Step 23.

Pre-build data readiness for each eval is documented in `docs/dataset-readiness.md`.

---

## Summary

| Eval | What it checks | Latest result | Date |
|---|---|---|---|
| 1 — Factual fidelity | Every representative_quote traces to a real review | ✅ PASS | 2026-06-14 |
| 2 — Aspect extraction | Dominant aspect (taste/effectiveness) ranks #1 or #2 | ✅ PASS | 2026-06-14 |
| 3 — Star-breakdown math | star_breakdown sums to the review count | ✅ PASS | 2026-06-14 |
| 4 — RAG retrieval relevance | 4/5 returned sources are on-topic | — | — |
| 5 — RAG answer grounding | Hedges appropriately on thin (2-review) evidence | — | — |

**Phase 2 checkpoint:** 3/3 of Evals 1–3 pass → proceed. ✅
**Phase 3 checkpoint:** proceed if ≥1/2 of Evals 4–5 pass.

---

## Run log

### Eval 1 — Factual Fidelity
- **Product:** health_personal_care-B0C1GMFYQG (Irish Moss, 57 reviews) + Dentitox (45)
- **Result:** ✅ PASS (2026-06-14, auto-checked at generation)
- **Notes:** Both health products had 0 ungrounded quotes (every representative_quote
  is a contiguous substring of a real review title/body). One fashion product
  (Pilestone) had 2 stitched/edited quotes — logged as mild FM-1 in
  model-behavior-log.md — but that product is outside Eval 1's scope.

### Eval 2 — Aspect Extraction Accuracy
- **Product:** Irish Moss; Dentitox; Hi-Lyte (all health)
- **Result:** ✅ PASS (2026-06-14)
- **Notes:** Dominant aspect lands in top 2 for all three — Irish Moss: taste #1;
  Dentitox: effectiveness #1, taste #2; Hi-Lyte: effectiveness #1, taste #2.

### Eval 3 — Star Breakdown Math
- **Product:** all 9
- **Result:** ✅ PASS (2026-06-14) — after Option A fix
- **Notes:** IMPORTANT: the model FABRICATED distributions (sums correct but
  per-star counts wrong on 9/9, biased optimistic). We now compute star_breakdown
  deterministically from the DB, so it is exact 9/9. See
  docs/star-breakdown-explainer.md and the FM-5 entry in model-behavior-log.md.
  Eval 3 passes for the right reason (correct numbers), not just a correct sum.

### Eval 4 — RAG Retrieval Relevance
- **Question:** "Does this cause any side effects?"
- **Product:** Hi-Lyte Electrolyte Powder (best side-effect coverage — see readiness report)
- **Result:** _not yet run_
- **Notes:**

### Eval 5 — RAG Answer Grounding
- **Question:** TBD (a ~2-review topic, e.g. Dentitox "price")
- **Product:** TBD
- **Result:** _not yet run_
- **Notes:**
