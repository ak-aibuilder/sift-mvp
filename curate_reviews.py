"""
Sift Data Curation Script
--------------------------
Downloads Amazon Reviews 2023 data for three categories,
finds 3 products per category with 30-60 reviews and mixed sentiment,
joins with metadata for product names, and outputs data/reviews.json.

Categories:
  - All_Beauty
  - Amazon_Fashion
  - Health_and_Personal_Care

Source: McAuley-Lab/Amazon-Reviews-2023 on Hugging Face
Raw files hosted at: datarepo.eng.ucsd.edu
"""

import gzip
import json
import os
import sys
import urllib.request
from collections import defaultdict
from pathlib import Path

# -- Configuration --

# Decision: The McAuley UCSD datarepo URLs 404 as of June 2026. Switched to the
# official HF-hosted mirror (McAuley-Lab/Amazon-Reviews-2023), which serves the
# raw files UNCOMPRESSED as .jsonl. parse_jsonl_gz sniffs gzip magic bytes so it
# handles both compressed and plain files transparently.
HF_BASE = "https://huggingface.co/datasets/McAuley-Lab/Amazon-Reviews-2023/resolve/main"
CATEGORIES = {
    "beauty": {
        "review_url": f"{HF_BASE}/raw/review_categories/All_Beauty.jsonl",
        "meta_url": f"{HF_BASE}/raw/meta_categories/meta_All_Beauty.jsonl",
    },
    "fashion": {
        "review_url": f"{HF_BASE}/raw/review_categories/Amazon_Fashion.jsonl",
        "meta_url": f"{HF_BASE}/raw/meta_categories/meta_Amazon_Fashion.jsonl",
    },
    "health_personal_care": {
        "review_url": f"{HF_BASE}/raw/review_categories/Health_and_Personal_Care.jsonl",
        "meta_url": f"{HF_BASE}/raw/meta_categories/meta_Health_and_Personal_Care.jsonl",
        "require_ingestible": True,  # supplements only, for evals 2 & 4 (see is_ingestible)
    },
}

PRODUCTS_PER_CATEGORY = 3
MIN_REVIEWS = 30
MAX_REVIEWS = 60
OUTPUT_PATH = "data/reviews.json"
DOWNLOAD_DIR = "data/raw"


# -- Helper Functions --

def download_file(url, dest_path):
    """Download a file with progress reporting."""
    if os.path.exists(dest_path):
        print(f"  Already downloaded: {dest_path}")
        return

    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    print(f"  Downloading: {url}")
    print(f"  Saving to: {dest_path}")

    def report_progress(block_num, block_size, total_size):
        downloaded = block_num * block_size
        if total_size > 0:
            percent = min(100, downloaded * 100 // total_size)
            mb_downloaded = downloaded / (1024 * 1024)
            mb_total = total_size / (1024 * 1024)
            print(f"\r  Progress: {percent}% ({mb_downloaded:.1f}/{mb_total:.1f} MB)", end="", flush=True)
        else:
            mb_downloaded = downloaded / (1024 * 1024)
            print(f"\r  Downloaded: {mb_downloaded:.1f} MB", end="", flush=True)

    urllib.request.urlretrieve(url, dest_path, reporthook=report_progress)
    print()  # newline after progress


def parse_jsonl_gz(filepath):
    """Stream-parse a JSONL file (gzipped or plain), yielding one dict per line."""
    # Sniff the gzip magic bytes (0x1f 0x8b) so this works whether the file is
    # compressed (old datarepo) or plain .jsonl (HF mirror).
    with open(filepath, "rb") as probe:
        is_gzip = probe.read(2) == b"\x1f\x8b"
    opener = gzip.open if is_gzip else open
    with opener(filepath, "rt", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    yield json.loads(line)
                except json.JSONDecodeError:
                    continue


def sentiment_variance(reviews):
    """
    Calculate variance of star ratings.
    Higher variance = more mixed sentiment = more interesting for the demo.
    """
    ratings = [r["rating"] for r in reviews]
    if not ratings:
        return 0
    avg = sum(ratings) / len(ratings)
    return sum((r - avg) ** 2 for r in ratings) / len(ratings)


# Decision: The health_personal_care category contains both devices and ingestible
# supplements. Variance-only ranking surfaced devices (eyelash curlers, razors),
# but Sift's evals 2 & 4 and the multivitamin use case require ingestibles that
# reviewers discuss in terms of taste / effectiveness / side effects. We gate the
# health category to "ingestible" products: taste OR effectiveness mentioned in
# >=15 reviews. This guarantees Eval 2's dominant aspect exists. Applied to health
# only via REQUIRE_INGESTIBLE in the category config; beauty/fashion are untouched.
INGESTIBLE_TASTE_WORDS = ("taste", "tastes", "flavor", "flavour", "swallow", "chalky")
INGESTIBLE_EFFECT_WORDS = ("effective", "effectiveness")
INGESTIBLE_MIN_MENTIONS = 15


def is_ingestible(reviews):
    """True if reviewers discuss taste OR effectiveness in >= INGESTIBLE_MIN_MENTIONS reviews."""
    texts = [(r.get("title", "") + " " + r.get("text", "")).lower() for r in reviews]
    taste = sum(1 for t in texts if any(w in t for w in INGESTIBLE_TASTE_WORDS))
    effect = sum(1 for t in texts if any(w in t for w in INGESTIBLE_EFFECT_WORDS))
    return taste >= INGESTIBLE_MIN_MENTIONS or effect >= INGESTIBLE_MIN_MENTIONS


def has_substantive_reviews(reviews, min_body_length=50, min_avg_body_length=150):
    """
    Check that most reviews have enough text to be useful for summarization.
    Two filters:
    1. At least 70% of reviews have body text >= min_body_length
    2. Average body length across all reviews >= min_avg_body_length
    """
    if not reviews:
        return False
    bodies = [r.get("text", "") for r in reviews]
    substantive = sum(1 for b in bodies if len(b) >= min_body_length)
    if (substantive / len(reviews)) < 0.7:
        return False
    avg_length = sum(len(b) for b in bodies) / len(reviews)
    return avg_length >= min_avg_body_length


def load_metadata_names(meta_filepath):
    """
    Load product names from metadata file.
    Returns dict: parent_asin -> product title.
    """
    names = {}
    print(f"  Loading metadata from: {meta_filepath}")
    for item in parse_jsonl_gz(meta_filepath):
        asin = item.get("parent_asin", "")
        title = item.get("title", "")
        if asin and title:
            names[asin] = title
    print(f"  Loaded {len(names)} product names")
    return names


# -- Main Curation Logic --

def curate_category(category_key, config):
    """
    Download and curate products for one category.
    Returns a list of product dicts matching the Sift schema.
    """
    print(f"\n{'='*60}")
    print(f"Processing category: {category_key}")
    print(f"{'='*60}")

    # Step 1: Download files
    review_file = os.path.join(DOWNLOAD_DIR, f"{category_key}_reviews.jsonl")
    meta_file = os.path.join(DOWNLOAD_DIR, f"{category_key}_meta.jsonl")

    download_file(config["review_url"], review_file)
    download_file(config["meta_url"], meta_file)

    # Step 2: Group reviews by product
    print(f"  Parsing reviews...")
    reviews_by_product = defaultdict(list)
    total_reviews = 0

    for review in parse_jsonl_gz(review_file):
        asin = review.get("parent_asin", "")
        if asin:
            reviews_by_product[asin].append(review)
            total_reviews += 1
            if total_reviews % 100000 == 0:
                print(f"    Parsed {total_reviews:,} reviews so far...")

    print(f"  Total reviews parsed: {total_reviews:,}")
    print(f"  Unique products found: {len(reviews_by_product):,}")

    # Step 3: Filter for products with 30-60 reviews
    candidates = {
        asin: revs
        for asin, revs in reviews_by_product.items()
        if MIN_REVIEWS <= len(revs) <= MAX_REVIEWS
    }
    print(f"  Products with {MIN_REVIEWS}-{MAX_REVIEWS} reviews: {len(candidates):,}")

    if not candidates:
        print(f"  WARNING: No products found in range. Trying 20-80 range...")
        candidates = {
            asin: revs
            for asin, revs in reviews_by_product.items()
            if 20 <= len(revs) <= 80
        }
        print(f"  Products with 20-80 reviews: {len(candidates):,}")

    if not candidates:
        print(f"  ERROR: No suitable products found for {category_key}")
        return []

    # Step 4: Filter for substantive review text
    candidates = {
        asin: revs
        for asin, revs in candidates.items()
        if has_substantive_reviews(revs)
    }
    print(f"  Products with substantive review text (70%+ over 50 chars, avg 150+ chars): {len(candidates):,}")

    # Step 4b: For ingestible categories (health), keep only supplement-like products
    if config.get("require_ingestible"):
        candidates = {a: revs for a, revs in candidates.items() if is_ingestible(revs)}
        print(f"  Ingestible products (taste/effectiveness in {INGESTIBLE_MIN_MENTIONS}+ reviews): {len(candidates):,}")

    # Step 5: Sort by sentiment variance (prefer mixed sentiment)
    sorted_candidates = sorted(
        candidates.items(),
        key=lambda x: sentiment_variance(x[1]),
        reverse=True,
    )

    # Step 6: Load metadata for product names
    product_names = load_metadata_names(meta_file)

    # Step 7: Pick top N products, preferring those with metadata
    selected = []
    for asin, revs in sorted_candidates:
        if len(selected) >= PRODUCTS_PER_CATEGORY:
            break

        product_name = product_names.get(asin, "")
        if not product_name:
            continue  # Skip products without a name in metadata

        avg_rating = sum(r["rating"] for r in revs) / len(revs)

        product = {
            "id": f"{category_key}-{asin}",
            "name": product_name,
            "category": category_key,
            "asin": asin,
            "avg_rating": round(avg_rating, 2),
            "review_count": len(revs),
            "reviews": [],
        }

        for i, r in enumerate(revs):
            # Convert timestamp to date string if available
            date_str = ""
            ts = r.get("timestamp")
            if ts:
                try:
                    from datetime import datetime
                    date_str = datetime.fromtimestamp(ts / 1000).strftime("%Y-%m-%d")
                except (ValueError, TypeError, OSError):
                    date_str = ""

            product["reviews"].append({
                "id": f"rev-{category_key}-{asin}-{i:03d}",
                "rating": int(r.get("rating", 0)),
                "title": r.get("title", ""),
                "body": r.get("text", ""),
                "reviewer_name": r.get("user_id", "Anonymous"),
                "date": date_str,
                "helpful_votes": r.get("helpful_vote", 0),
            })

        selected.append(product)
        variance = sentiment_variance(revs)
        avg_body_len = sum(len(r.get("text", "")) for r in revs) / len(revs)
        print(f"  Selected: {product_name[:50]}... ({len(revs)} reviews, variance={variance:.2f}, avg={avg_rating:.1f}, avg_body={avg_body_len:.0f} chars)")

    if len(selected) < PRODUCTS_PER_CATEGORY:
        print(f"  WARNING: Only found {len(selected)} products (wanted {PRODUCTS_PER_CATEGORY})")

    return selected


def main():
    print("Sift Data Curation")
    print("==================")
    print(f"Target: {PRODUCTS_PER_CATEGORY} products per category, {MIN_REVIEWS}-{MAX_REVIEWS} reviews each")
    print(f"Categories: {', '.join(CATEGORIES.keys())}")
    print()

    all_products = []

    for category_key, config in CATEGORIES.items():
        products = curate_category(category_key, config)
        all_products.extend(products)

    # Write output
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)

    output = {"products": all_products}

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    # Summary
    print(f"\n{'='*60}")
    print("CURATION COMPLETE")
    print(f"{'='*60}")
    print(f"Output file: {OUTPUT_PATH}")
    print(f"Total products: {len(all_products)}")

    total_reviews = sum(p["review_count"] for p in all_products)
    print(f"Total reviews: {total_reviews}")

    print(f"\nBreakdown:")
    for p in all_products:
        ratings = [r["rating"] for r in p["reviews"]]
        star_dist = {s: ratings.count(s) for s in range(1, 6)}
        print(f"  [{p['category']}] {p['name'][:45]}...")
        print(f"    Reviews: {p['review_count']} | Avg: {p['avg_rating']} | Stars: {star_dist}")

    # Validation checks for evals
    print(f"\n--- Eval Readiness Checks ---")
    products_40_plus = [p for p in all_products if p["review_count"] >= 40]
    print(f"Products with 40+ reviews (for Eval 1): {len(products_40_plus)}")
    if not products_40_plus:
        print("  WARNING: Need at least 1 product with 40+ reviews for Eval 1")

    print(f"\nDone. Review the output at {OUTPUT_PATH} before proceeding to build.")


if __name__ == "__main__":
    main()
