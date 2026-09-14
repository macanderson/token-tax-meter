import { translate } from "../lib/providers.mjs";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try {
    res.status(200).json(await translate((req.body || {}).text));
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message });
  }
}
