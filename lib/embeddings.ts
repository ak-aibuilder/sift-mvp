// Local embedding model wrapper (@huggingface/transformers, all-MiniLM-L6-v2).
//
// Decision: embeddings run locally and free — no API key, no per-query cost. The
// model (~25MB quantized) downloads once on first use and is cached on disk.
// Decision: embedding dimension is 384 (fixed by all-MiniLM-L6-v2). Do NOT change
// the model without re-running generate-embeddings — stored vectors must match.

import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';

export const EMBEDDING_DIM = 384;

function modelName(): string {
  return process.env.EMBEDDING_MODEL || 'Xenova/all-MiniLM-L6-v2';
}

// Lazy singleton — load the model once, reuse for every embed call.
// Cast `pipeline` to a simple signature: its overload union for the task arg is
// too complex for TS to represent (TS2590) when the model name is a dynamic string.
const loadExtractor = pipeline as unknown as (
  task: 'feature-extraction',
  model: string
) => Promise<FeatureExtractionPipeline>;

let _extractorPromise: Promise<FeatureExtractionPipeline> | null = null;
function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!_extractorPromise) {
    _extractorPromise = loadExtractor('feature-extraction', modelName());
  }
  return _extractorPromise;
}

// Embed one piece of text into a unit-length 384-d vector. Mean pooling + L2
// normalize is the standard recipe for all-MiniLM sentence embeddings.
export async function embedText(text: string): Promise<Float32Array> {
  const extractor = await getExtractor();
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  return new Float32Array(output.data as ArrayLike<number>);
}

// Cosine similarity. Vectors from embedText are already normalized (so this is a
// dot product), but we compute it fully so it stays correct for any input.
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
