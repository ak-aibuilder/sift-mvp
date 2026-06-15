// Seed: load data/reviews.json into the products + reviews tables.
// Run: npm run seed

import fs from 'node:fs';
import {
  getDb,
  insertProduct,
  insertReview,
  type Category,
} from '../lib/db';

// Load .env.local if present (for DATABASE_PATH); harmless if absent.
try {
  process.loadEnvFile('.env.local');
} catch {
  /* no .env.local — defaults apply */
}

const DATA_PATH = process.env.REVIEWS_JSON || './data/reviews.json';

// Shape of the curated JSON (curate_reviews.py output). Note it carries an `asin`
// (dropped — not a schema column) and `date` (mapped to reviews.review_date).
interface RawReview {
  id: string;
  rating: number;
  title?: string;
  body: string;
  reviewer_name?: string;
  date?: string;
  helpful_votes?: number;
}
interface RawProduct {
  id: string;
  name: string;
  category: Category;
  avg_rating?: number;
  review_count?: number;
  reviews: RawReview[];
}

function main() {
  if (!fs.existsSync(DATA_PATH)) {
    console.error(`Missing ${DATA_PATH}. Run curate_reviews.py first.`);
    process.exit(1);
  }

  const { products } = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8')) as {
    products: RawProduct[];
  };
  const db = getDb();

  let pCount = 0;
  let rCount = 0;
  const seed = db.transaction((items: RawProduct[]) => {
    for (const p of items) {
      insertProduct({
        id: p.id,
        name: p.name,
        category: p.category,
        avg_rating: p.avg_rating ?? null,
        review_count: p.review_count ?? p.reviews.length,
        image_url: null, // curated dataset has no images; UI uses a placeholder
      });
      pCount++;
      for (const r of p.reviews) {
        insertReview({
          id: r.id,
          product_id: p.id,
          rating: r.rating,
          title: r.title ?? null,
          body: r.body,
          reviewer_name: r.reviewer_name ?? null,
          review_date: r.date ?? null,
          helpful_votes: r.helpful_votes ?? 0,
        });
        rCount++;
      }
    }
  });
  seed(products);

  // -- Verify --
  const totals = db
    .prepare('SELECT (SELECT COUNT(*) FROM products) p, (SELECT COUNT(*) FROM reviews) r')
    .get() as { p: number; r: number };
  const byCat = db
    .prepare(
      `SELECT category, COUNT(*) products, SUM(review_count) reviews
       FROM products GROUP BY category ORDER BY category`
    )
    .all() as { category: string; products: number; reviews: number }[];

  console.log(`Seeded ${pCount} products and ${rCount} reviews.`);
  console.log(`DB now holds: ${totals.p} products, ${totals.r} reviews.\n`);
  for (const c of byCat) {
    console.log(`  ${c.category.padEnd(22)} ${c.products} products, ${c.reviews} reviews`);
  }

  if (totals.r !== rCount) {
    console.warn(`\nWARNING: reviews inserted (${rCount}) != reviews in DB (${totals.r}).`);
  }
}

main();
