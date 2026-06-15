// Pre-compute an embedding for every review and store it in review_embeddings.
// Run: npm run generate:embeddings
//
// Decision: embeddings are pre-baked so the deployed app only ever embeds the
// user's question at query time (Risk 2/6 fallback — ship vectors in the DB).
// Decision: embed "title. body" (not body alone) — titles are short and topical
// (e.g. "Upset my stomach"), which improves retrieval recall for Q&A.

try {
  process.loadEnvFile('.env.local');
} catch {
  /* defaults apply */
}

import {
  getAllProducts,
  getReviewsByProduct,
  insertEmbedding,
  embeddingToBlob,
} from '../lib/db';
import { embedText, EMBEDDING_DIM } from '../lib/embeddings';

const MODEL = process.env.EMBEDDING_MODEL || 'Xenova/all-MiniLM-L6-v2';

async function main() {
  const products = getAllProducts();
  const total = products.reduce((s, p) => s + (p.review_count ?? 0), 0);
  console.log(`Embedding reviews for ${products.length} products (~${total} reviews) with ${MODEL}`);
  console.log('First run downloads the model (~25MB); subsequent runs use the cache.\n');

  let done = 0;
  let dimChecked = false;
  for (const p of products) {
    const reviews = getReviewsByProduct(p.id);
    for (const r of reviews) {
      const text = r.title ? `${r.title}. ${r.body}` : r.body;
      const vec = await embedText(text);

      if (!dimChecked) {
        if (vec.length !== EMBEDDING_DIM) {
          throw new Error(`Expected ${EMBEDDING_DIM}-d embeddings, got ${vec.length}.`);
        }
        dimChecked = true;
      }

      insertEmbedding({
        review_id: r.id,
        product_id: p.id,
        embedding: embeddingToBlob(vec),
        model_used: MODEL,
      });
      done++;
    }
    console.log(`  [${p.category.slice(0, 6)}] ${p.name.slice(0, 38).padEnd(38)} ${reviews.length} embedded (${done}/${total})`);
  }

  console.log(`\nDone. Embedded ${done} reviews (dim=${EMBEDDING_DIM}).`);
  console.log('Next: POST /api/products/[id]/ask, then run Evals 4 & 5 (Step 16).');
}

main();
