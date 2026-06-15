import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native/heavy deps must not be bundled by Next — load them from node_modules
  // at runtime on the Node.js server. better-sqlite3 is a native addon;
  // @huggingface/transformers pulls onnxruntime + wasm.
  serverExternalPackages: ['better-sqlite3', '@huggingface/transformers'],
};

export default nextConfig;
