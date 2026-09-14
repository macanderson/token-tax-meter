// Token tax meter — local server.
// Reads API keys from .env.local (sibling file), serves index.html,
// and returns billed token counts for any configured model.
//
//   node server.mjs            → http://localhost:4400
//   PORT=5000 node server.mjs  → custom port
//
// No dependencies. Requires Node 18+ (built-in fetch).

import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// ---------- .env.local ----------
function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnv(join(here, ".env.local"));

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";
const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
const PORT = Number(process.env.PORT || 4400);

// ---------- models.json ----------
const models = JSON.parse(readFileSync(join(here, "models.json"), "utf8"));

// ---------- counting ----------
// Both providers report the billed input count for a whole request, which
// includes a fixed per-message envelope. The UI measures the envelope once
// (a one-character message minus one) and subtracts it.

async function countAnthropic(model, text) {
  const res = await fetch("https://api.anthropic.com/v1/messages/count_tokens", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model, messages: [{ role: "user", content: text }] }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Anthropic HTTP ${res.status}`);
  return data.input_tokens;
}

async function countOpenAI(model, text) {
  // OpenAI has no count endpoint; the billed figure is usage.prompt_tokens
  // on a real completion. max_completion_tokens: 1 keeps it near-free.
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({ model, max_completion_tokens: 1, messages: [{ role: "user", content: text }] }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `OpenAI HTTP ${res.status}`);
  return data.usage.prompt_tokens;
}

// ---------- http ----------
function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "content-type": type });
  res.end(type === "application/json" ? JSON.stringify(body) : body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = "";
    req.on("data", (c) => (s += c));
    req.on("end", () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === "GET" && url.pathname === "/") {
    return send(res, 200, readFileSync(join(here, "index.html"), "utf8"), "text/html; charset=utf-8");
  }

  if (req.method === "GET" && url.pathname === "/api/config") {
    return send(res, 200, {
      keys: { anthropic: Boolean(ANTHROPIC_KEY), openai: Boolean(OPENAI_KEY) },
      models,
    });
  }

  if (req.method === "POST" && url.pathname === "/api/count") {
    try {
      const { provider, model, text } = await readBody(req);
      if (!provider || !model || typeof text !== "string") return send(res, 400, { error: "provider, model and text are required" });
      if (provider === "anthropic") {
        if (!ANTHROPIC_KEY) return send(res, 400, { error: "ANTHROPIC_API_KEY is not set in .env.local" });
        return send(res, 200, { tokens: await countAnthropic(model, text) });
      }
      if (provider === "openai") {
        if (!OPENAI_KEY) return send(res, 400, { error: "OPENAI_API_KEY is not set in .env.local" });
        return send(res, 200, { tokens: await countOpenAI(model, text) });
      }
      return send(res, 400, { error: `unknown provider: ${provider}` });
    } catch (e) {
      return send(res, 502, { error: e.message });
    }
  }

  send(res, 404, { error: "not found" });
}).listen(PORT, () => {
  const k = [];
  if (ANTHROPIC_KEY) k.push("Anthropic");
  if (OPENAI_KEY) k.push("OpenAI");
  console.log(`token tax meter → http://localhost:${PORT}`);
  console.log(k.length ? `keys loaded: ${k.join(", ")}` : "no keys found — copy .env.local.example to .env.local and add yours");
});
