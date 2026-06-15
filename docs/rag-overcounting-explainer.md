# Explainer: Why the Q&A Sometimes Says "Multiple Reviewers" When Only One Did

A plain-English writeup of an FM-4 (over-generalization) finding in the RAG Q&A, the
fix we tried, why it only half-worked, and what we decided. A companion to
`docs/star-breakdown-explainer.md`. Date: 2026-06-15.

---

## The setting: how the Q&A counts evidence

When a shopper asks a question, Sift retrieves the 5 most similar reviews and the
model writes a grounded answer. A trustworthy answer must be **proportional** — its
wording should match how many reviews *actually* say the thing:

```
1 review says it      ->  "one reviewer mentions…"
2 reviews say it      ->  "a couple of reviewers mention…"
many reviews say it   ->  "most reviewers say…"
```

Saying "multiple reviewers" when only one actually did is the same class of bug as the
star breakdown: it *quietly* makes the evidence look stronger than it is.

---

## What we found

**Question:** "Is it gentle on sensitive teeth?" (Cordless Water Flosser)

Here are the 5 retrieved reviews. Only **one** explicitly mentions *sensitive teeth*;
the rest are about general gentleness / gums / adjustable pressure:

```
#  score  review
1  0.58   "Works great on sensitive teeth and gums"        <- EXPLICIT (sensitive teeth)
2  0.49   "Very easy to use. My teeth feel great!"          ~ tangential
3  0.40   "…a very good experience! Express delivery…"      ~ unrelated
4  0.40   "cleans my teeth very well and is easily adjustable"  ~ tangential (gentle)
5  0.39   "leaves your gums feeling clean"                  ~ tangential (gums)
```

**The model's answer:** *"Yes, it is gentle on sensitive teeth, according to **multiple
reviewers**."* (one run even said "**Four reviewers**.")

Only **one** review explicitly addresses sensitive teeth — but the model reported
"multiple." It silently promoted gum/gentleness reviews into "sensitive teeth"
evidence.

```
   explicit "sensitive teeth" reviews:   1   ←── the truth
   what the model implied:               "multiple" / "four"
                                         └── inflated, optimistic again
```

---

## Why it matters for Sift

It's the same trust problem as the star chart, one layer down. The shopper asked a
*specific* question; an honest answer is "one reviewer says it works on sensitive
teeth." "Multiple reviewers" overstates a single data point — and a shopper with
genuinely sensitive teeth is exactly the person who can't afford an inflated answer.

---

## Why it happens

The model treats **semantically related** reviews as if they address the **specific**
topic. To the model, "gentle on gums" and "adjustable pressure" *feel like* evidence
for "gentle on sensitive teeth." It blurs "related to the topic" into "about the
topic," then counts the blurred set.

> It's not making up reviews (that would be FM-1). It's **over-counting** real but
> only-tangentially-relevant reviews — over-generalizing from thin specific evidence.
> That is FM-4.

---

## What we did to fix it

We tightened the Q&A prompt's proportionality rule to draw an explicit line between
*about the topic* and *merely related*:

> **COUNT ONLY EXPLICIT MENTIONS.** When you say how many reviewers mention something,
> count ONLY reviews that EXPLICITLY address the specific topic asked. A review that is
> merely related does NOT count: e.g. a review praising general gentleness or "gentle
> on gums" does NOT count as addressing "sensitive teeth" specifically. … If exactly
> one review explicitly addresses the topic, say "one reviewer" — never "multiple
> reviewers."

Note we even named the exact gums-vs-sensitive-teeth trap in the instruction.

---

## Why the issue persisted

The fix **measurably helped the clear cases** but **did not fix the original case**:

| Question | Before | After the fix |
|---|---|---|
| "Slippery on floors?" (1 rev about boots) | "Two reviewers mention… slippery" | ✅ "**Only one reviewer** mentions… **no review directly addresses** floors" |
| "Run true to size?" | "may not run true to size" | ✅ itemizes "one reviewer… another reviewer" |
| "Easy to use?" (control) | "many reviewers" | ✅ "all 5 reviewers" (did **not** over-correct) |
| **"Gentle on sensitive teeth?"** | "multiple… four reviewers" | ❌ **still "multiple reviewers"** (both runs) |

The model **read an explicit, example-backed instruction telling it not to count
gum-gentleness as sensitive-teeth evidence — and did it anyway.** That's the key
insight: on a *semantically overlapping* topic, this is a **robust model judgment**,
not a prompt gap. (It's arguably even defensible — gum-gentleness *is* related
evidence.) More prompt pressure hits diminishing returns fast.

---

## What we decided (Option A)

We **keep the stricter prompt** (it genuinely improved the unambiguous cases) and
**accept the residual as a documented model limitation** rather than chase it with
heavier machinery.

We rejected the two heavier levers because each trades this small problem for a bigger
one:

| Lever | Why we rejected it |
|---|---|
| **Similarity threshold** (drop sources below ~0.5) | Would force "one reviewer" here, but **starve** legitimately-thin topics — the health "side effects" question scores 0.28–0.33, so thresholding retrieves *nothing* and **fails Eval 4/5** there. |
| **Second-pass LLM verification** | Re-checking each cited review doubles LLM calls + latency per question. Over-engineered for a demo. |

This is the "**capability bet**" case from the build spec (Risk 5): when the model has
a real limitation, log it honestly and ship with a known gap rather than burn
unbounded effort fighting it.

### The contrast with the star breakdown
Worth noting *why* the two findings get different fixes:

- **Star breakdown** is a **database fact** — we can compute it exactly, so we
  override the model. (Deterministic fix.)
- **"How many reviewers explicitly mean X"** is a **judgment about language** — there's
  no exact value to compute, and the judgment is genuinely fuzzy at the gums/sensitive-
  teeth boundary. So we improve the instruction and accept the residual. (Prompt fix +
  documented limitation.)

Right tool for each: compute what's computable, instruct (and bound your effort on)
what's judgment.

---

## Where the related records live
- **The behavior, fix attempt, and outcome:** `docs/model-behavior-log.md`
  (FM-4 entry, 2026-06-15).
- **The eval that surfaced it:** `docs/eval-results.md` (manual per-category pass,
  Eval 5 beauty).
- **The code:** `lib/prompts.ts` (QA_SYSTEM rule 2, "COUNT ONLY EXPLICIT MENTIONS").
