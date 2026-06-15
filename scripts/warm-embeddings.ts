// Downloads + caches the embedding model so the first runtime query doesn't pay
// for it. Run during the Docker build (Risk 2 mitigation). No API key needed.

import { embedText, EMBEDDING_DIM } from '../lib/embeddings';

embedText('warmup')
  .then((v) => {
    console.log(`Embedding model cached (dim=${v.length}, expected ${EMBEDDING_DIM}).`);
  })
  .catch((e) => {
    console.error('warm-embeddings failed:', (e as { message?: string })?.message ?? e);
    process.exit(1);
  });
