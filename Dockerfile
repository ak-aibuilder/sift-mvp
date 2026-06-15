# Sift — Railway deployment.
#
# Decision: single stage on the full node:24 image (not -slim). It carries the
# build toolchain so better-sqlite3 / onnxruntime-node compile if a prebuilt
# binary is missing — reliability over image size for a demo deploy.
# Decision: ship data/sift.db (pre-baked summaries + embeddings) inside the image,
# and pre-cache the embedding model at build time so the first Q&A is fast.
FROM node:24

WORKDIR /app
ENV NODE_ENV=production

# Install dependencies first (better layer caching). npm ci needs devDeps for the
# build + warm steps, so don't set NODE_ENV=production before this.
COPY package.json package-lock.json ./
RUN npm ci --include=dev

# App source — includes data/sift.db with baked summaries + embeddings.
COPY . .

# Production build.
RUN npm run build

# Pre-cache the all-MiniLM embedding model into the image (Risk 2 mitigation).
# Non-fatal: if the build host has no network, the model downloads at runtime.
RUN npm run warm || echo "warm-embeddings skipped (model will download on first query)"

# Railway injects PORT at runtime; next start binds to it (defaults to 3000).
EXPOSE 3000
CMD ["npm", "start"]
