# Build Log

Per-phase record of what was built, problems hit, fixes applied, and verification
results. Appended at each Phase checkpoint. Complements (does not replace):

- In-code `# Decision:` / `// Decision:` comments — the design record (per spec §5)
- `docs/dataset-readiness.md` — pre-build data validation
- `docs/eval-results.md` — Eval 1–5 pass/fail
- `docs/model-behavior-log.md` — unexpected model behavior

---

## Phase 1 — Project Scaffold ✅ (2026-06-14)

### Delivered
- Next.js 16.2.9 (App Router) + TypeScript + Tailwind v4, React 19.2.4.
- `lib/db.ts` — SQLite connection (WAL + foreign keys), full 4-table schema
  (products, reviews, summaries, review_embeddings), typed query helpers incl.
  Float32Array↔BLOB conversion for embeddings.
- `lib/llm.ts` — env-configurable OpenAI-compatible chat client.
- `.env.example` — LLM + embedding + DB vars documented.
- `scripts/seed-reviews.ts` — `npm run seed`; loads `data/reviews.json`.
- Docs scaffolded: `build-log.md` (this), `model-behavior-log.md`, `eval-results.md`.

### Problems hit & fixes (the non-obvious bits to remember)

1. **Data source moved (spec URLs are dead).** The UCSD datarepo URLs in
   `curate_reviews.py` / the spec return HTTP 404 as of June 2026. Switched to the
   Hugging Face mirror `McAuley-Lab/Amazon-Reviews-2023`, which serves files
   **uncompressed** (`.jsonl`, not `.jsonl.gz`). Parser now sniffs gzip magic bytes.
   Full detail in `docs/dataset-readiness.md`.

2. **`better-sqlite3` v11 won't build on Node 24.** v11.10 has no prebuilt binary
   for Node 24 (ABI 137) and its source fails to compile against the current
   toolchain (`make` error in `better_sqlite3.o`). **Fix: pinned to `^12.10.1`**,
   which ships Node 24 prebuilds (no compilation). SQLite 3.53.2. Do **not**
   downgrade below v12 while on Node 24.

3. **npm 11 blocks lifecycle scripts by default.** Install warned that `esbuild`
   and `protobufjs` postinstall scripts were not run (`allow-scripts` gate).
   `tsx`/`esbuild` still worked (esbuild ships per-platform optional-dep binaries,
   not a postinstall fetch), so seeding ran fine. **Watch in Phase 3:** if
   `@huggingface/transformers` / onnxruntime errors at runtime, run
   `npm approve-scripts protobufjs` (or reinstall allowing scripts).

### Verification (Phase 1 checkpoint)
- DB: 4 tables present, `journal_mode=wal`.
- Counts: **9 products, 365 reviews**, 0 summaries, 0 embeddings.
- **Integrity: every product's stored `review_count` == actual review rows** (clean
  ground truth for Eval 3 / FM-5).
- Field mapping correct: JSON `date` → `reviews.review_date`; `asin` dropped (not a
  schema column); `image_url` NULL (curated data has no images).
- `npx tsc --noEmit` → exit 0.
- `.gitignore` excludes `node_modules`, `data/raw/` (~3.5 GB), db WAL/shm sidecars,
  `.env.local`; tracks `.env.example`. `data/sift.db` intentionally trackable (ships
  in container).

### Carried forward (address in later phases)
- **Reviewer names are raw Amazon user-id hashes** (e.g.
  `AFVMTDNIUKIT655NYO52I37MW6LA`) — source has no display names. Truncate/relabel in
  the Phase 4 UI; don't render the raw hash.
- **Eval 4 is the weak eval** (side-effect retrieval). Best candidate is Hi-Lyte
  Electrolyte. Tune threshold/prompt in Phase 3 if it fails. See readiness report.
- **`data/sift.db` shipping decision** finalized at Phase 5 (Dockerfile): commit the
  baked db vs. rebuild in-container.

---

## Phase 2 — Summarization Pipeline ✅ (2026-06-14)

### Delivered
- `lib/prompts.ts` — summary output schema + category-specific summarization prompts
  (fashion / health / beauty), each constraint mapped to a failure mode.
- `scripts/generate-summaries.ts` — `npm run generate:summaries`; 2s rate-limit delay;
  parses model JSON, applies deterministic fixes, validates, stores. Built-in
  pre-checks for Eval 1 (quote grounding) and FM-5 (star distribution).
- `app/api/products/route.ts` and `app/api/products/[id]/summary/route.ts` — both
  smoke-tested against the running dev server (correct shapes + 404 handling).
- Summaries generated for all 9 products.

### Headline finding — FM-5: the model fabricates star distributions
The biggest result of the phase. Llama 3.1 8B produced `star_breakdown` objects whose
sums were always correct (9/9) but whose per-star counts were wrong on **all 9
products**, consistently biased to make products look better (5★ inflated, 1★
suppressed). It passes Eval 3 as literally written (sum check) while displaying false
numbers. **Decision (Option A, user-approved):** compute `star_breakdown`
deterministically from the DB (`getStarBreakdown`) and override the model; log the
model's guess as the finding. Reverses the earlier "keep it model-generated" call —
the data made the case. Full plain-English writeup with illustrations:
`docs/star-breakdown-explainer.md`.

### Other model behaviors (detail in docs/model-behavior-log.md)
- **FM-3 NOT observed (good):** all 9 bimodal products returned `overall_sentiment:
  "mixed"` — no sentiment averaging.
- **FM-1 (mild):** Pilestone color-blind glasses had 2 stitched/edited quotes (large
  verbatim fragment + an added prefix). Health products (Eval 1 scope) had 0.
- **Instruction slip:** aspects' tail occasionally out of frequency order (3/9). Fixed
  deterministically (sort in generate-summaries.ts). Now 9/9 sorted.

### Evals 1–3 (detail in docs/eval-results.md)
- Eval 1 Factual fidelity — ✅ PASS (health products, 0 ungrounded quotes).
- Eval 2 Aspect extraction — ✅ PASS (taste/effectiveness top-2 on all health products).
- Eval 3 Star-breakdown math — ✅ PASS (after Option A; exact 9/9, not just sums).
- **Checkpoint: 3/3 pass → proceed to Phase 3.**

### Engineering issue fixed
- **ESM env-loading bug:** `import` hoisting meant a script's top-level
  `process.loadEnvFile('.env.local')` ran *after* `lib/llm.ts`/`lib/db.ts` had already
  captured env at module load → `LLM_API_KEY` read as empty, generation failed.
  **Fix:** read env LAZILY (inside `getLlm()`/`getModel()`/`getDb()`), not at module
  top. First generation run failed on this; second succeeded.

### Verification
- `npx tsc --noEmit` → exit 0.
- DB: 9 summaries stored; star_breakdown exact 9/9 vs actual; aspects sorted 9/9.
- API routes return correct payloads; bad id → 404.

### Carried forward
- Eval 4 (RAG side-effects) still the weak eval — addressed in Phase 3.
- Pilestone FM-1 quote-stitching: optional prompt hardening ("copy one contiguous
  sentence; no ellipses / no joining") if it recurs on in-scope products. Not done
  now (Risk 5 budget; health products are clean).

<!-- Append Phase 3 below at its checkpoint. -->
