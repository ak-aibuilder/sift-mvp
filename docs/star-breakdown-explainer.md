# Explainer: Why Sift Computes the Star Breakdown Instead of Trusting the Model

A plain-English writeup of a real failure we found in Phase 2 and the fix we chose
(Option A). Kept as a teaching reference. Date: 2026-06-14.

---

## What is `star_breakdown`?

It's the little chart on a product page showing how many reviews gave each star
rating. For example:

```
5 ★  ██████████████████             18
4 ★  ████                            4
3 ★  ██                              2
2 ★  ████                            4
1 ★  █████████████████████████████  29
                                     ── total: 57 reviews
```

In our summaries the AI returns this as a small object:
`{ "5": 18, "4": 4, "3": 2, "2": 4, "1": 29 }`.

Two things must be true about it:
1. **The numbers add up** to the total review count (18+4+2+4+29 = 57). ← *what Eval 3 checks*
2. **The numbers are actually correct** — there really are 29 one-star reviews.

---

## What we found

Llama 3.1 8B gets **#1 right every time** but **#2 wrong every time.**

Real example — **BareOrganics Irish Moss** (57 reviews):

| Stars | Real count (database) | AI reported | Off by |
|------:|----------------------:|------------:|-------:|
| 5 ★   | 18                    | **23** ⬆️    | +5     |
| 4 ★   | 4                     | 5           | +1     |
| 3 ★   | 2                     | 3           | +1     |
| 2 ★   | 4                     | 4           | 0      |
| 1 ★   | **29**                | **22** ⬇️    | −7     |
| **Σ** | **57**                | **57** ✓     |        |

Both columns total 57 — so it *looks* fine and passes Eval 3 — but the AI **invented**
the distribution: it claimed 23 five-star reviews (there are 18) and hid 7 of the 29
one-star reviews.

This was **not a one-off**. Across all 9 products, **0/9** had a correct distribution,
and the error always leaned the same way: **make the product look better than it is.**

```
                model 5★  vs  real 5★        model 1★  vs  real 1★
Pilestone:        20      >     13             3       <     11
Hi-Lyte:          19      >     15             3       <      9
Irish Moss:       23      >     18            22       <     29
                  └─ inflated positives ─┘    └─ suppressed negatives ─┘
```

---

## Why this matters for Sift specifically

Sift's whole job is to help a shopper **trust** what real buyers said — especially the
negative feedback ("does this cause stomach issues?"). A star chart that quietly
understates the 1-star reviews does the *opposite* of our job: it hides the bad news.
For a trust product, that's the worst kind of bug.

---

## Why it happens (the key insight)

The model **guesses** the distribution from the overall vibe of the reviews instead of
counting them. But we never needed it to count: the real numbers are sitting in our
database, and counting how many reviews have each rating is exact, trivial arithmetic
a computer does perfectly.

> Asking a language model to tally star ratings is like asking a poet to do your taxes.
> Right tool for the job: **database does math, AI does language.**

---

## The fix we chose (Option A)

At summary-generation time we:
1. **Count the real distribution** straight from the reviews table
   (`getStarBreakdown()` in `lib/db.ts`).
2. **Override** the model's guess with that ground truth before saving.
3. **Still log** the model's wrong guess as our headline FM-5 finding — it's a great
   research result, just not something we display.

We also sort the "aspects" list by frequency ourselves, for the same reason (the model
occasionally ordered the tail wrong, and no eval depends on it doing the sort).

Result after the fix: **9/9 products show the correct distribution**, and the negative
reviews are represented honestly.

### Trade-off we accepted
We stop "trusting the AI" for this one field. That's correct on purpose: the star
breakdown is a **database fact, not an opinion.** Eval 3 now passes for the right
reason (correct numbers), not on the technicality of a correct sum.

---

## Where the related records live
- **The model behavior itself:** `docs/model-behavior-log.md` (FM-5 entry).
- **What we built and decided this phase:** `docs/build-log.md` (Phase 2).
- **Eval pass/fail:** `docs/eval-results.md`.
- **The code:** `lib/db.ts` (`getStarBreakdown`) and `scripts/generate-summaries.ts`
  (override + sort, with the model's error logged).
