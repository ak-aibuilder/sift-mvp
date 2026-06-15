// OpenAI-compatible LLM client, configured entirely via env vars.
//
// Decision: Coded against the standard /v1/chat/completions API. Swap providers
// (Groq, Together, Ollama, OpenAI, ...) by changing LLM_BASE_URL / LLM_API_KEY /
// LLM_MODEL only. No per-provider adapter layer.

import OpenAI from 'openai';

const DEFAULT_BASE_URL = 'https://api.groq.com/openai/v1';
const DEFAULT_MODEL = 'llama-3.1-8b-instant';

// Read env LAZILY (at call time, not module-load): ESM hoists imports, so a
// script's top-level process.loadEnvFile() runs AFTER this module is evaluated.
// Reading here ensures the key is seen once env is loaded.
export function getModel(): string {
  return process.env.LLM_MODEL || DEFAULT_MODEL;
}

let _client: OpenAI | null = null;

export function getLlm(): OpenAI {
  if (_client) return _client;
  const apiKey = process.env.LLM_API_KEY || '';
  const baseURL = process.env.LLM_BASE_URL || DEFAULT_BASE_URL;
  if (!apiKey) {
    throw new Error(
      'LLM_API_KEY is not set. Copy .env.example to .env.local and add your key.'
    );
  }
  _client = new OpenAI({ baseURL, apiKey });
  return _client;
}

export type ChatMessage = OpenAI.Chat.ChatCompletionMessageParam;

export interface ChatResult {
  content: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  model: string;
}

export interface ChatOptions {
  // Decision: default low temperature — summaries and grounded Q&A want
  // determinism, not creativity.
  temperature?: number;
  // Request JSON output (Groq/OpenAI honor response_format json_object).
  jsonMode?: boolean;
  model?: string;
  maxTokens?: number;
}

export async function chat(
  messages: ChatMessage[],
  opts: ChatOptions = {}
): Promise<ChatResult> {
  const res = await getLlm().chat.completions.create({
    model: opts.model || getModel(),
    messages,
    temperature: opts.temperature ?? 0.2,
    ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
    ...(opts.jsonMode ? { response_format: { type: 'json_object' } } : {}),
  });

  const choice = res.choices[0];
  return {
    content: choice?.message?.content ?? '',
    prompt_tokens: res.usage?.prompt_tokens ?? null,
    completion_tokens: res.usage?.completion_tokens ?? null,
    model: res.model || opts.model || getModel(),
  };
}
