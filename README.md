# Token tax meter

Measures what each model actually bills for the same sentence in six languages, then turns the result into a shareable "Token Tax Receipt" image. Every number comes from the provider's own billed count, not a local tokenizer estimate.

## Run locally

```
cp .env.local.example .env.local   # add your OpenRouter key
node server.mjs                    # http://localhost:4400
```

Node 18 or newer. No dependencies.

## Deploy

The repo is a zero-config Vercel project: `index.html` is served statically, `api/*.js` are serverless functions.

```
vercel env add OPENROUTER_API_KEY production
vercel --prod
```

## Configure

- `.env.local` / Vercel env — `OPENROUTER_API_KEY` (covers every model in `models.json`). Optional `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` for `models.json` entries with `provider: "anthropic"` / `"openai"`. Models whose key is missing show as disabled.
- `models.json` — the list of models to offer. Each needs `provider` (`openrouter`, `anthropic` or `openai`), `id`, and `label`.
- `lib/providers.mjs` — `LANGUAGES` (the six measured languages), `MAX_TEXT` (phrase length cap), and the translation model.
- `index.html` — `DEFAULT` holds the hand-checked translations of the default phrase; the receipt renderer is `drawReceipt`.

## How the numbers are produced

OpenRouter: each sentence is sent as a one-token chat completion with `usage: { include: true }`, and `usage.prompt_tokens` is the upstream provider's native count (verified identical to the direct Anthropic and OpenAI APIs). Cost is a few thousandths of a cent per call.

Anthropic direct: `POST /v1/messages/count_tokens`, which is free. OpenAI direct: `usage.prompt_tokens` from a one-token completion.

Every provider includes a fixed per-request envelope in the count. The tool measures it once per model by sending a single character and subtracting one, then subtracts that envelope from every sentence. Envelope sizes are shown in the last row so you can sanity-check them.

Custom phrases are translated into all six languages by Gemini 2.5 Flash (via OpenRouter) before measuring; the source-language text is kept verbatim.

## Share image

After a measurement, the receipt section renders a 1080×1350 PNG on a canvas: the phrase, every language's native text, token count, multiplier vs English, a heat bar, the worst-case "surcharge", and the cost per million sends at the model's listed input price. Download, copy to clipboard, native share, or post the caption to X and attach the image.

Results also export as CSV or tab-separated text.
