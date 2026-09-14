import { count } from "../lib/providers.mjs";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try {
    const { provider, model, text } = req.body || {};
    if (!provider || !model) return res.status(400).json({ error: "provider, model and text are required" });
    res.status(200).json({ tokens: await count(provider, model, text) });
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message });
  }
}
