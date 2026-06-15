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

## Phase 3 — RAG Q&A Pipeline ✅ (2026-06-14)

### Delivered
- `lib/embeddings.ts` — local all-MiniLM-L6-v2 wrapper: `embedText()` (384-d, mean
  pooling + L2 normalize) and `cosineSimilarity()`. Lazy singleton model load.
- `scripts/generate-embeddings.ts` — `npm run generate:embeddings`; embeds "title.
  body" for every review. **365/365 embedded** (1536 bytes each = 384×4).
- `lib/prompts.ts` — added the RAG Q&A prompt (grounding + proportional-hedging rules,
  maps to FM-4) and `QaResult` type.
- `app/api/products/[id]/ask/route.ts` — embed question → cosine top-5 → grounded LLM
  answer → `{ answer, sources, reviews_searched, reviews_cited }`.
- `next.config.ts` — `serverExternalPackages` for better-sqlite3 + transformers.

### Risk 6 cleared
@huggingface/transformers runs fine inside a Next.js route handler (with
`serverExternalPackages` + `runtime = 'nodejs'`). No WASM/bundling fallback needed.
First request has a cold-start cost (model load in-process); fine for a demo.

### Evals 4–5 (detail in docs/eval-results.md)
- **Eval 4 Retrieval relevance — ❌ FAIL (data limitation).** "Does this cause side
  effects?" → only 1/5 retrieved sources truly on-topic. Verified root cause: the
  dataset has ~1 genuine adverse-effect review across the health products; retrieval
  + grounding both work, the content just isn't there. Not fixable by prompt/threshold.
- **Eval 5 Answer grounding — ✅ PASS.** Proportional hedging on thin evidence; refused
  to fabricate an absent attribute (vegan question → "no clear indication", FM-2 avoided).
- **Checkpoint: 1/2 RAG evals pass (Eval 5) → proceed to Phase 4.**

### Model behaviors (detail in docs/model-behavior-log.md)
- **FM-4 NOT observed (good):** consistent proportional hedging.
- **FM-2 NOT observed (good):** no fabricated attributes on the vegan question.

### Verification
- `npx tsc --noEmit` → exit 0 (after working around transformers' TS2590 pipeline
  union via a narrow cast in lib/embeddings.ts).
- DB: 9 summaries + 365 embeddings; ask route returns correct payloads; 400 on empty
  question, 404 on unknown product / missing embeddings.

### Carried forward
- **Eval 4 gap is accepted, not fixed.** Cumulative eval pass rate is now 4/5. To turn
  Eval 4 green would require re-curating the health set toward a supplement with many
  genuine "upset stomach / reaction" reviews. Revisit only if the demo needs a clean
  5/5; otherwise document as a known limitation in the README (Phase 5 / Step 24).

## Pre-Phase-4 validation gate (2026-06-15)

Before building the UI, ran a full validation sweep across all products/categories.

- **`scripts/validate.ts` (`npm run validate`)** — reusable harness: data integrity
  + FM-1/3/5 + Evals 1–5, all categories. Result **26 PASS / 0 FAIL / 2 WARN** (the 2
  WARN = the two already-documented limitations). Two false failures during
  development were traced to *test* flaws (a non-thin question; a too-narrow
  hedge-detector), not the model — fixed.
- **Manual per-category eval pass** (1 product/category, requested) — see
  docs/eval-results.md. Eval 1 clean 3/3 all categories; Eval 2 health/beauty pass,
  fashion marginal (expected aspect at #3); Eval 4 retrieval 5/5 wherever content
  exists; Eval 5 good with one FM-4 borderline.
- **FM-4 finding + Option A (user-approved).** On "Is it gentle on sensitive teeth?"
  the model said "multiple reviewers" when only 1 review explicitly mentions sensitive
  teeth. Tightened QA_SYSTEM to "COUNT ONLY EXPLICIT MENTIONS" — improved the clear
  cases but the model resisted the instruction on the gums≈sensitive-teeth overlap.
  Decided: keep the stricter prompt, accept the residual as a documented model
  limitation (heavier levers would regress thin-topic recall). Full writeup:
  **docs/rag-overcounting-explainer.md** (companion to the star-breakdown explainer).
- **Catalog note:** "fashion" = glasses/shoe-heels, "beauty" = flosser/IPL/eyelashes,
  so aspect questions like "scent"/"fit-sizing" don't always map — flagged for the UI
  and README.

## Phase 4 — Frontend + Integration ✅ (2026-06-15)

### Delivered
- `app/page.tsx` — home product grid (9 cards: category badge, stars, review count).
- `app/products/[id]/page.tsx` — product detail: overall-sentiment badge + prose,
  rating-breakdown bars, aspect cards (sentiment dot + mention count + quote).
- `app/products/[id]/ask-box.tsx` — client Q&A: input + example chips, loading
  skeleton, grounded answer, cited source reviews (stars + % match).
- `lib/display.ts` — shared label/color helpers; `app/layout.tsx` — Sift header,
  "Research Preview" badge, footer disclaimer; `app/globals.css` simplified.

### Design decision
- Server components read SQLite directly (no internal HTTP hop); the `/api` routes
  stay for the interactive Q&A and external consumers.

### Verification (this phase was QA, not model-evals — UI doesn't change model behavior)
- `npx tsc --noEmit` → clean.
- Render checks: home returns all 9 product links; detail renders summary + star bars
  with correct widths (Irish Moss 5★=31.6% / 1★=50.9%, matching its real skew).
- Real-browser walkthrough (gstack browse): home grid, detail page, and the full Q&A
  flow (clicked an example question → grounded answer + cited sources). **Zero console
  errors** on every page. 404 works for unknown product IDs.
- **Regression check: `npm run validate` re-run after the UI work → 26 PASS / 0 FAIL /
  2 WARN, unchanged.** Phase 4 touched only UI files, so the data/model pipeline is
  unaffected — now confirmed, not assumed.

### Gaps / honest notes
- Frontend QA was **manual** (render + browser walkthrough). No automated frontend
  test suite is committed (no Playwright/RTL tests). Acceptable for a demo; would be
  the first thing to add for production. The reusable backend gate is `npm run validate`.
- The Phase-1 "reviewer-name hash" concern is moot: the UI never renders raw reviewer
  names (Q&A sources show only excerpt + rating + match score).
- The catalog mismatch (gadgets, not apparel/cosmetics) is visible in the UI — e.g.
  beauty cards are flossers/IPL, not products with "scent". Note for the README.

### Carried forward (Phase 5)
- Dockerfile (ship data/sift.db with baked summaries + embeddings).
- README: setup, provider-swap, and the known limitations (Eval 4 data gap, FM-4
  over-counting, catalog mismatch).
- Re-run all 5 evals + `npm run validate` against the deployed URL (Step 23).

## Deployment gate (pre-Phase-5, 2026-06-15)

The big validation gate before deploying. Steps, findings, results — full detail in
docs/eval-results.md ("Deployment gate" section) and docs/model-behavior-log.md.

1. **Full manual walkthrough — all 9 products.** Drove the live Q&A (same path the UI
   calls) × 3 questions each = 27 Q&A, plus every detail page. **All HTTP 200, every
   answer grounded with 5 sources, 0 errors / 0 empty / no dead states / no stuck
   spinners.** Browser walkthrough (home → detail → Q&A) clean. Screenshots captured
   for Post 2 (`/tmp/post2-*.png`).
2. **Cross-category eval sweep — 15/15 pass** on fresh products (IPL / Blue Light /
   Dentitox): Eval 1 quotes traced 3/3; Eval 2 dominant aspect #1 3/3; Eval 3 star
   math exact 3/3; Eval 4 retrieval 5/5, 4/5, 5/5 (aspect-present questions); Eval 5
   hedging 3/3. Eval 4 nuance: passes wherever the aspect exists — the earlier
   "failure" is specifically the absent side-effects content, re-confirmed.
3. **Phase 4 model behaviors logged.** One new UI-surfaced RAG behavior (negative
   product + "what do people like most?" → thin/negative answer); no new summary
   defects; the explicit-count fix holds in prod. See model-behavior-log 2026-06-15.
4. **Production build + hydration.** `npm run build` succeeds (TS clean, routes
   correct). A `next dev` hydration warning was investigated (body/html/input/widths
   all match SSR; DOM-extra attrs were only browser case-normalization + Next's dev
   overlay) and confirmed **dev-only**: production (`npm start`) hydrates with zero
   console errors. Deployed users unaffected.
5. **Railway env vars** — see below / README. The deployed app needs LLM_BASE_URL,
   LLM_API_KEY, LLM_MODEL set in the Railway service Variables, or Q&A 500s.
6. **Regression:** `npm run validate` → 26 PASS / 0 FAIL / 2 WARN, unchanged.

**Gate verdict: GO.** Build is production-clean, evals green across categories, no
breakage in the walkthrough, all findings documented.

## Phase 5 — Deploy + Ship (in progress, 2026-06-15)

### Delivered (Claude Code: Steps 21, 24)
- **`Dockerfile`** (Step 21) — single stage on full `node:24` (build toolchain
  included so better-sqlite3 / onnxruntime compile if a prebuild is missing).
  Ships `data/sift.db` with baked summaries + embeddings; `npm run warm` pre-caches
  the all-MiniLM model into the image (Risk 2 mitigation), non-fatal if the build
  host lacks network. Railway injects `PORT`; `next start` binds to it.
- **`.dockerignore`** — excludes node_modules, .next, `.env.local` (secret),
  data/raw, db WAL/shm, .git, docs. Keeps `data/sift.db`.
- **`scripts/warm-embeddings.ts`** + `npm run warm`.
- **`README.md`** (Step 24) — 2-sentence pitch, local setup, 3-var provider swap,
  Railway deploy, and an honest "What works / what doesn't" (star-breakdown
  fabrication, FM-4 over-counting, Eval 4 data gap, catalog mismatch, SQLite
  concurrency), linking the explainer docs.

### Verified locally (Docker unavailable here, so Railway builds the image)
- `npm run build` clean; `npm run warm` caches the model (dim 384); `tsc --noEmit`
  clean. The only unverifiable bit is the Linux native-binary compile — mitigated by
  using the full `node:24` base.

### Deployed + verified (Steps 22-23, 2026-06-15)
- **Deployed to Railway:** https://sift-mvp-production.up.railway.app — build
  succeeded (native binaries compiled/prebuilt on the node:24 base), env vars set,
  embedding model served from the image cache.
- **Step 23 — all 5 evals run on the live URL** (see docs/eval-results.md "Deployed
  eval run"): **4/5 pass**, identical to local. Eval 1/2/3 = 3/3; Eval 4 beauty 5/5,
  fashion 4/5, health side-effects 2/5 (documented data gap); Eval 5 hedging holds in
  prod ("No review directly addresses … dentures"). Smoke test of all endpoints green.

### Remaining (user: Step 25)
- Tag `week-01-sift`, post builder's log. (I can create the tag on request.)
