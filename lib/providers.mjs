// Provider adapters. Every function returns the provider's own billed input
// count for one user message — never a local tokenizer estimate.
//
// Keys come from process.env (Vercel) or .env.local (server.mjs loads it).
//   OPENROUTER_API_KEY  — one key, every model; native upstream counts.
//   ANTHROPIC_API_KEY   — direct; free count_tokens endpoint.
//   OPENAI_API_KEY      — direct; one-token completion, usage.prompt_tokens.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const models = JSON.parse(readFileSync(join(here, "..", "models.json"), "utf8"));

const key = (name) => process.env[name] || "";
export const keys = () => ({
  anthropic: Boolean(key("ANTHROPIC_API_KEY")),
  openai: Boolean(key("OPENAI_API_KEY")),
  openrouter: Boolean(key("OPENROUTER_API_KEY")),
});

export const MAX_TEXT = 600; // chars; keeps a public deployment cheap

const fail = (msg, status) => Object.assign(new Error(msg), { status });

async function countAnthropic(model, text) {
  const res = await fetch("https://api.anthropic.com/v1/messages/count_tokens", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, messages: [{ role: "user", content: text }] }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Anthropic HTTP ${res.status}`);
  return data.input_tokens;
}

async function countOpenAI(model, text) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key("OPENAI_API_KEY")}` },
    body: JSON.stringify({ model, max_completion_tokens: 1, messages: [{ role: "user", content: text }] }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `OpenAI HTTP ${res.status}`);
  return data.usage.prompt_tokens;
}

// OpenRouter with usage.include returns the upstream provider's native count
// (verified: "x" → 8 on Claude, 7 on GPT-5, identical to the direct APIs).
async function openrouter(body) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key("OPENROUTER_API_KEY")}`,
      "http-referer": "https://token-tax-meter.vercel.app",
      "x-title": "Token tax meter",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data?.error?.message || `OpenRouter HTTP ${res.status}`);
  return data;
}

async function countOpenRouter(model, text) {
  const data = await openrouter({ model, max_tokens: 1, messages: [{ role: "user", content: text }], usage: { include: true } });
  return data.usage.prompt_tokens;
}

export async function count(provider, model, text) {
  if (typeof text !== "string" || !text) throw fail("text is required", 400);
  if (text.length > MAX_TEXT) throw fail(`text must be ≤ ${MAX_TEXT} characters`, 400);
  const need = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", openrouter: "OPENROUTER_API_KEY" }[provider];
  if (!need) throw fail(`unknown provider: ${provider}`, 400);
  if (!key(need)) throw fail(`${need} is not set`, 400);
  if (provider === "anthropic") return countAnthropic(model, text);
  if (provider === "openai") return countOpenAI(model, text);
  return countOpenRouter(model, text);
}

// ---------- pricing ($ per input token), from OpenRouter's public catalogue ----------
let priceCache = { at: 0, map: null };
export async function prices() {
  if (priceCache.map && Date.now() - priceCache.at < 6 * 3600e3) return priceCache.map;
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models");
    const data = await res.json();
    const map = {};
    for (const m of data.data || []) {
      const p = Number(m.pricing?.prompt);
      if (Number.isFinite(p) && p > 0) map[m.id] = p;
    }
    priceCache = { at: Date.now(), map };
  } catch {
    priceCache = { at: Date.now(), map: priceCache.map || {} };
  }
  return priceCache.map;
}

// ---------- translation (for custom phrases) ----------
export const LANGUAGES = ["English", "Spanish", "Arabic", "Hindi", "Chinese", "Burmese"];
const TRANSLATE_MODEL = "google/gemini-2.5-flash";

export async function translate(text) {
  if (typeof text !== "string" || !text.trim()) throw fail("text is required", 400);
  if (text.length > MAX_TEXT) throw fail(`text must be ≤ ${MAX_TEXT} characters`, 400);
  if (!key("OPENROUTER_API_KEY")) throw fail("OPENROUTER_API_KEY is not set", 400);
  const data = await openrouter({
    model: TRANSLATE_MODEL,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          `Translate the user's text faithfully into each of: ${LANGUAGES.join(", ")}. ` +
          `Chinese means Simplified Chinese. Keep meaning, tone and length; do not add commentary. ` +
          `Reply with ONLY a JSON object: {"source_language": <one of the names or "Other">, "translations": {<language name>: <text>, ...}} with all ${LANGUAGES.length} languages present.`,
      },
      { role: "user", content: text },
    ],
  });
  let out;
  try { out = JSON.parse(data.choices[0].message.content); } catch { throw new Error("translator returned malformed JSON"); }
  const t = out.translations || {};
  for (const l of LANGUAGES) if (typeof t[l] !== "string" || !t[l].trim()) throw new Error(`translator omitted ${l}`);
  if (LANGUAGES.includes(out.source_language)) t[out.source_language] = text.trim(); // keep the user's exact words
  return { source: out.source_language, translations: Object.fromEntries(LANGUAGES.map((l) => [l, t[l].trim()])) };
}
