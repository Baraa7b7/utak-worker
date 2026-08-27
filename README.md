# UTAK Worker — v1

Cloudflare Worker that sits between Meta WhatsApp Cloud API and Odoo. Verifies webhooks, dedups messages, classifies intent with Claude Haiku, dispatches to a small handler switch, sends replies via Meta Graph.

## Endpoints

| Method | Path       | Purpose                                              |
|--------|------------|------------------------------------------------------|
| GET    | `/`        | Sanity ping — returns `UTAK Worker v1`               |
| GET    | `/health`  | Runs Odoo smoke test, returns JSON with mode + timestamp |
| GET    | `/webhook` | Meta verification challenge (echoes `hub.challenge`) |
| POST   | `/webhook` | Meta events — HMAC-verified, deduped, routed         |

## File tree

```
utak-worker/
├── src/
│   ├── index.ts     Entry — routes GET/POST
│   ├── config.ts    Env interface + constants + system prompts
│   ├── types.ts     Shared TypeScript types
│   ├── dedup.ts     KV-backed 24h message dedup
│   ├── meta.ts      Verify, HMAC, parse, sendText
│   ├── odoo.ts      JSON-2 client + X-Api-Key/session fallback + typed helpers
│   ├── claude.ts    Anthropic wrapper — classifyIntent + composeReply
│   └── router.ts    Intent dispatch switch
├── wrangler.toml
├── package.json
├── tsconfig.json
└── .gitignore
```

## First-time setup

```bash
npm install
npx wrangler login

# Create the KV namespace, paste both ids into wrangler.toml
npx wrangler kv namespace create MSG_DEDUP
npx wrangler kv namespace create MSG_DEDUP --preview

# Set secrets (values from your notes)
npx wrangler secret put META_APP_SECRET
npx wrangler secret put META_ACCESS_TOKEN
npx wrangler secret put META_VERIFY_TOKEN        # any string; must match value entered in Meta UI
npx wrangler secret put ODOO_API_KEY
npx wrangler secret put ANTHROPIC_API_KEY

# Update ODOO_LOGIN in wrangler.toml [vars] to your Odoo user email
# (used only if X-Api-Key auth fails and we fall back to session cookie)
```

## Local dev

```bash
npm run dev            # runs on http://localhost:8787
curl http://localhost:8787/health
```

## Deploy

```bash
npm run deploy         # publishes to *.workers.dev, prints the URL
npm run tail           # tail logs in real time
```

Take the deployed URL (e.g. `https://utak-worker.<subdomain>.workers.dev/webhook`) and paste it into Meta → WhatsApp → Configuration → Webhook, along with the `META_VERIFY_TOKEN` you set.

## Data contracts

**Worker ↔ Odoo (JSON-2 API):**
- `POST {ODOO_URL}/json/2/{model}/{method}`
- Auth: `X-Api-Key` header; on 401 the client falls back to `/web/session/authenticate` and reuses the `session_id` cookie for the isolate's lifetime.
- Body: kwargs as JSON. Errors surface as `{"data": {"name": "...", "message": "...", "status": 4xx}}` and get thrown as typed `Error`s.

**Worker ↔ Anthropic:**
- Classifier: Haiku, 200 max tokens, forced JSON output `{"intent": "...", "confidence": 0-1}`
- Composer: Sonnet, 500 max tokens, plain text Arabic reply

## v1 scope

- Text messages only
- Customer path: auto-create in Odoo on first message, greet or reply via Claude
- Supplier path: acknowledge only ("استلمنا، جاري المعالجة"); price extraction lives in v2
- Everything else: 404 or ignore

## v2 backlog (do not scope-creep v1)

- Image/audio messages
- Supplier price extraction → `x_daily_price` rows
- 2 AM cron for `supplier_price_request` template ask
- Customer notification cron for `customer_new_prices`
- Full order flow (cart, checkout, invoice hooks)
- Move outbound to Queue if inline latency exceeds ~3s

## Notes

- Model IDs live in `wrangler.toml [vars]` so you can rotate to newer Claude versions without a code change.
- `META_GRAPH_VERSION` currently `v22.0` — bump when Meta deprecates.
- The dispatch `switch` in `router.ts` stays flat until any single case exceeds ~50 lines; then extract to `router/handlers/<intent>.ts`.
