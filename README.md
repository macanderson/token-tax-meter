# Token tax meter

Measures what each model actually bills for the same sentence in six languages. Every number comes from the provider's own billed count, not a local tokenizer estimate.

## Run

```
cp .env.local.example .env.local   # add your keys
node server.mjs                    # http://localhost:4400
```

Node 18 or newer. No dependencies.

## Configure

- `.env.local` — `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, optional `PORT`. Models whose key is missing show as disabled.
- `models.json` — the list of models to offer. Add or remove entries; each needs `provider` (`anthropic` or `openai`), `id`, and `label`.
- `index.html` — the `SENTENCES` array at the top of the script holds the test sentences.

## How the numbers are produced

Anthropic: `POST /v1/messages/count_tokens`, which is free and returns the billable input count.

OpenAI: there is no count endpoint, so each sentence is sent as a one-token chat completion and `usage.prompt_tokens` is read from the response. That is the billed figure. Cost is negligible.

Both providers include a fixed per-request envelope in the count. The tool measures it once per model by sending a single character and subtracting one, then subtracts that envelope from every sentence. Envelope sizes are shown in the last row so you can sanity-check them.

Results export as CSV or tab-separated text.
