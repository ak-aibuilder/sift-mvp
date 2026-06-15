# Dataset Readiness Report

**Generated:** 2026-06-13 (pre-build, Phase 1 gate)
**Artifact:** `data/reviews.json` — 9 products, 365 reviews
**Source:** McAuley-Lab/Amazon-Reviews-2023 (Hugging Face mirror)
**Curation script:** `curate_reviews.py`

This report captures the **pre-build data validation** — confirming the curated
dataset can support the five evals defined in the build spec. It is distinct from:

- `docs/eval-results.md` — actual Eval 1–5 pass/fail against generated summaries (Phase 2/3)
- `docs/model-behavior-log.md` — unexpected model behavior during the build

Regenerate the underlying numbers any time with the validation snippet at the bottom.

---

## 1. Curation summary

- **9 products**, 3 per category, **365 total reviews** (target was 270–540).
- **0 empty review bodies**; all products have real metadata names.
- Every product has a **bimodal star distribution** — deliberate, to stress-test
  FM-3 (sentiment averaging). None is uniformly 5-star.
- Raw source files (~3.5 GB uncompressed) are cached in `data/raw/`.
  **These must be gitignored — they should not be committed.** Only the 174 KB
  `data/reviews.json` ships.

### Per-product breakdown

| Category | Product | Reviews | Avg | Star dist (1/2/3/4/5) | Avg body |
|---|---|---:|---:|---|---:|
| beauty | TIUXYYC Magnetic Eyelashes | 30 | 3.33 | 12/0/1/0/17 | 194 |
| beauty | IPL Hair Removal | 44 | 2.84 | 21/2/2/1/18 | 171 |
| beauty | Cordless Water Flosser | 49 | 3.43 | 17/1/2/2/27 | 167 |
| fashion | Blue Light Blocking Glasses | 37 | 2.81 | 16/5/1/0/15 | 189 |
| fashion | Pilestone Color Blind Glasses | 32 | 3.09 | 11/4/1/3/13 | 256 |
| fashion | KANEIJI Shoe Repair Heels | 39 | 3.51 | 12/1/1/5/20 | 230 |
| health | BareOrganics Irish Moss (superfood) | 57 | 2.61 | 29/4/2/4/18 | 178 |
| health | Dentitox Pro Drops (teeth/gums) | 45 | 2.47 | 25/3/2/1/14 | 161 |
| health | Hi-Lyte Electrolyte Powder | 32 | 3.31 | 9/4/2/2/15 | 249 |

The three **health** products are all ingestible supplements — required because the
spec's Evals 2 & 4 and the multivitamin use case need taste / effectiveness /
side-effect discussion. (The first curation pass selected health *devices* on
variance alone; see Section 4.)

---

## 2. Eval readiness

Aspect-word mention counts are reviews-containing-the-word, computed over title+body.

| Eval | Requirement | Status | Evidence |
|---|---|---|---|
| **1** Factual fidelity | Health product with 40+ reviews | ✅ | Irish Moss (57), Dentitox (45) |
| **2** Aspect extraction | Health product with taste/effectiveness in 15+ reviews | ✅ | Irish Moss taste=23; Dentitox taste=16, effect=13; Hi-Lyte taste=23, effect=11 |
| **3** Star-breakdown math | Any product | ✅ | Build-time generation; counts above are ground truth to check sums against |
| **4** RAG side-effect retrieval | Health product where 4/5 retrieved sources discuss side effects | ⚠️ tight | Side-effect mentions: Hi-Lyte=4, Irish Moss=2, Dentitox=1. Hi-Lyte is the best bet. |
| **5** RAG grounding on thin evidence | A topic mentioned by only ~2 reviews | ✅ | Dentitox "price"=2, IPL "smell"=2, Pilestone "expensive"=2 |

### The Eval 4 caveat (known risk)

These supplements draw more **taste** and **"doesn't work"** complaints than
**side-effect** reports. The best candidate is **Hi-Lyte Electrolyte Powder**, where
~4 reviews discuss stomach/cramps/tolerability. Getting 4/5 retrieved sources on
side effects is plausible but not guaranteed.

This is deferred to Phase 3 by design — the spec runs Eval 4 at Step 16, where the
checkpoint passes if 1/2 RAG evals pass and explicitly allows tuning the similarity
threshold. If Eval 4 fails there, the fix is either prompt/threshold tuning or
swapping Hi-Lyte for a supplement with heavier side-effect discussion (re-curation
is a ~1-min re-parse; raw files are cached).

---

## 3. Mapping to failure modes (FM-1 .. FM-5)

| FM | Covered by the data because... |
|---|---|
| FM-1 Fabricated quotes | All bodies are real, substantive text — quotes are checkable substrings |
| FM-2 Aspect hallucination | Known dominant aspects per product (taste, effectiveness) give a ground truth |
| FM-3 Sentiment averaging | Every product is bimodal (e.g. Irish Moss 29×1★ + 18×5★) |
| FM-4 Over-generalization | Thin-evidence topics exist (Eval 5 candidates above) |
| FM-5 Star-breakdown math | Exact star counts in Section 1 are the arithmetic check |

---

## 4. Changes made to `curate_reviews.py`

All recorded as in-code `# Decision:` comments per the spec (code is the record):

1. **Data source moved.** The UCSD datarepo URLs 404 as of June 2026. Switched to
   the HF mirror, which serves files **uncompressed** as `.jsonl`. `parse_jsonl_gz`
   now sniffs gzip magic bytes so it reads both compressed and plain files.
2. **Ingestible filter for health only.** Added `is_ingestible()` and a
   `require_ingestible` flag on the health category config: keep only products with
   taste OR effectiveness in 15+ reviews. Beauty/fashion selection is unchanged.

---

## 5. Regenerate these numbers

```bash
python3 - <<'EOF'
import json
d=json.load(open("data/reviews.json"))
TASTE=("taste","tastes","flavor","flavour","swallow","chalky")
EFFECT=("effective","effectiveness","work","results")
SIDE=("side effect","stomach","nausea","headache","cramp","diarrhea","upset","sick",
      "reaction","broke out","jittery","tolerate","gut","bloat")
for p in d["products"]:
    txt=[(r['title']+" "+r['body']).lower() for r in p['reviews']]
    f=lambda ws: sum(1 for x in txt if any(w in x for w in ws))
    print(f"[{p['category'][:6]}] {p['name'][:34]:36} n={p['review_count']:3} "
          f"taste={f(TASTE):2} effect={f(EFFECT):2} side={f(SIDE):2}")
EOF
```
