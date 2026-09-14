// Token tax meter — local server. Runs the same handlers Vercel runs from
// api/, plus index.html. Reads keys from .env.local.
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

const PORT = Number(process.env.PORT || 4400);
const { keys } = await import("./lib/providers.mjs");
const routes = {
  "/api/config": (await import("./api/config.js")).default,
  "/api/count": (await import("./api/count.js")).default,
  "/api/translate": (await import("./api/translate.js")).default,
};

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
  // Minimal Vercel-style res helpers so api/*.js runs unchanged.
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(b)); };

  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(readFileSync(join(here, "index.html"), "utf8"));
  }
  const handler = routes[url.pathname];
  if (!handler) return res.status(404).json({ error: "not found" });
  try {
    if (req.method === "POST") req.body = await readBody(req);
  } catch {
    return res.status(400).json({ error: "invalid JSON body" });
  }
  return handler(req, res);
}).listen(PORT, () => {
  const k = Object.entries(keys()).filter(([, v]) => v).map(([n]) => n);
  console.log(`token tax meter → http://localhost:${PORT}`);
  console.log(k.length ? `keys loaded: ${k.join(", ")}` : "no keys found — copy .env.local.example to .env.local and add yours");
});
