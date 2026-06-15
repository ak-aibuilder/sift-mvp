// SQLite connection + schema + typed query helpers.
//
// Decision: SQLite holds everything (products, reviews, summaries, embeddings) in
// one file shipped inside the Railway container. No external DB at demo scale.
// Decision: WAL mode so Railway can serve concurrent reads without SQLITE_BUSY.

import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

// Read lazily inside getDb() (not at module load): ESM hoists imports above a
// script's top-level process.loadEnvFile(), so reading here keeps a custom
// DATABASE_PATH from .env.local honored.
const DEFAULT_DB_PATH = './data/sift.db';

// -- Types (mirror the SQLite schema) --

export type Category = 'fashion' | 'health_personal_care' | 'beauty';

export interface Product {
  id: string;
  name: string;
  category: Category;
  avg_rating: number | null;
  review_count: number | null;
  image_url: string | null;
}

export interface Review {
  id: string;
  product_id: string;
  rating: number;
  title: string | null;
  body: string;
  reviewer_name: string | null;
  review_date: string | null;
  helpful_votes: number;
}

export interface Summary {
  product_id: string;
  summary_json: string;
  model_used: string;
  generated_at: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
}

export interface ReviewEmbedding {
  review_id: string;
  product_id: string;
  embedding: Buffer;
  model_used: string;
}

// -- Connection (singleton) --

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  const dbPath = process.env.DATABASE_PATH || DEFAULT_DB_PATH;
  // Ensure the parent directory exists (e.g. ./data) before opening.
  const dir = path.dirname(dbPath);
  if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  _db = new Database(dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  initSchema(_db);
  return _db;
}

export function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL CHECK(category IN ('fashion', 'health_personal_care', 'beauty')),
      avg_rating REAL,
      review_count INTEGER,
      image_url TEXT
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES products(id),
      rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
      title TEXT,
      body TEXT NOT NULL,
      reviewer_name TEXT,
      review_date TEXT,
      helpful_votes INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_id);

    CREATE TABLE IF NOT EXISTS summaries (
      product_id TEXT PRIMARY KEY REFERENCES products(id),
      summary_json TEXT NOT NULL,
      model_used TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      prompt_tokens INTEGER,
      completion_tokens INTEGER
    );

    CREATE TABLE IF NOT EXISTS review_embeddings (
      review_id TEXT PRIMARY KEY REFERENCES reviews(id),
      product_id TEXT NOT NULL REFERENCES products(id),
      embedding BLOB NOT NULL,
      model_used TEXT NOT NULL DEFAULT 'Xenova/all-MiniLM-L6-v2'
    );
    CREATE INDEX IF NOT EXISTS idx_embeddings_product ON review_embeddings(product_id);
  `);
}

// -- Product / review queries --

export function getAllProducts(): Product[] {
  return getDb()
    .prepare('SELECT * FROM products ORDER BY category, name')
    .all() as Product[];
}

export function getProductById(id: string): Product | undefined {
  return getDb().prepare('SELECT * FROM products WHERE id = ?').get(id) as
    | Product
    | undefined;
}

export function getReviewsByProduct(productId: string): Review[] {
  return getDb()
    .prepare('SELECT * FROM reviews WHERE product_id = ? ORDER BY id')
    .all(productId) as Review[];
}

// Ground-truth star distribution counted directly from the reviews table.
// Decision: star_breakdown is a database fact, not a model judgment — the LLM
// fabricates plausible-but-wrong distributions (see docs/star-breakdown-explainer.md),
// so generation computes this and overrides the model's guess.
export function getStarBreakdown(
  productId: string
): { '1': number; '2': number; '3': number; '4': number; '5': number } {
  const out = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
  const rows = getDb()
    .prepare('SELECT rating, COUNT(*) c FROM reviews WHERE product_id = ? GROUP BY rating')
    .all(productId) as { rating: number; c: number }[];
  for (const r of rows) {
    const k = String(r.rating) as keyof typeof out;
    if (k in out) out[k] = r.c;
  }
  return out;
}

export function insertProduct(p: Product): void {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO products (id, name, category, avg_rating, review_count, image_url)
       VALUES (@id, @name, @category, @avg_rating, @review_count, @image_url)`
    )
    .run(p);
}

export function insertReview(r: Review): void {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO reviews (id, product_id, rating, title, body, reviewer_name, review_date, helpful_votes)
       VALUES (@id, @product_id, @rating, @title, @body, @reviewer_name, @review_date, @helpful_votes)`
    )
    .run(r);
}

// -- Summary queries --

export function upsertSummary(s: Summary): void {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO summaries (product_id, summary_json, model_used, generated_at, prompt_tokens, completion_tokens)
       VALUES (@product_id, @summary_json, @model_used, @generated_at, @prompt_tokens, @completion_tokens)`
    )
    .run(s);
}

export function getSummary(productId: string): Summary | undefined {
  return getDb()
    .prepare('SELECT * FROM summaries WHERE product_id = ?')
    .get(productId) as Summary | undefined;
}

// -- Embedding queries --

// Float32Array <-> BLOB. Copy into a fresh Buffer so we never persist an
// embedding's backing ArrayBuffer with the wrong offset/length.
export function embeddingToBlob(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer.slice(vec.byteOffset, vec.byteOffset + vec.byteLength));
}

export function blobToEmbedding(blob: Buffer): Float32Array {
  return new Float32Array(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength));
}

export function insertEmbedding(e: ReviewEmbedding): void {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO review_embeddings (review_id, product_id, embedding, model_used)
       VALUES (@review_id, @product_id, @embedding, @model_used)`
    )
    .run(e);
}

export function getEmbeddingsForProduct(
  productId: string
): { review_id: string; embedding: Float32Array }[] {
  const rows = getDb()
    .prepare('SELECT review_id, embedding FROM review_embeddings WHERE product_id = ?')
    .all(productId) as { review_id: string; embedding: Buffer }[];
  return rows.map((row) => ({
    review_id: row.review_id,
    embedding: blobToEmbedding(row.embedding),
  }));
}
