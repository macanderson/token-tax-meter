import { models, keys, prices, LANGUAGES, MAX_TEXT } from "../lib/providers.mjs";

export default async function handler(req, res) {
  const price = await prices();
  res.setHeader("cache-control", "public, max-age=300");
  res.status(200).json({
    keys: keys(),
    languages: LANGUAGES,
    maxText: MAX_TEXT,
    models: models.map((m) => ({ ...m, price: price[m.id] ?? null })),
  });
}
