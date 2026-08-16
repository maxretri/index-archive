# INDEX

**Forward anything. Find everything.**

INDEX is an open-source private visual archive that lives inside Telegram. Send or forward a photo, video, document, or audio file to the INDEX bot; open the Telegram Mini App; the file is already in a quiet, chronological library.

INDEX deliberately does **not** access Telegram chat history, Saved Messages, or the rest of a Telegram account.

## The model

```text
Telegram = file transport and primary binary storage
Postgres = private metadata and search index
Mini App = visual library
```

The bot only indexes files a user explicitly sends, forwards, or uploads. Original binaries are not copied into Supabase.

## Current MVP

- Telegram Bot API ingestion for photos, videos, documents, and audio
- Minimal `SAVED TO INDEX.` response with an `OPEN INDEX` Mini App button
- Cryptographically verified Telegram Mini App `initData`
- Short-lived server-signed application sessions
- Owner-scoped APIs plus Supabase/Postgres RLS defense in depth
- Cursor-paginated, chronological photo and media library
- Telegram-hosted thumbnails, lazy loading, and reserved image aspect ratios
- Fullscreen photo, video, and PDF viewers with mobile swipe navigation
- Original download/open, favorites, tags, and virtual multi-file collections
- Revocable read-only collection links shared through Telegram's native recipient picker
- Search across filename, type, MIME type, caption, tags, collections, and date range
- Mini App uploads with progress; the server sends the binary through Telegram before indexing it
- Recurring INDEX PLUS membership through Telegram Stars: `299 XTR` every 30 days, with cancel/resume controls
- A restrained first-party sponsor placement for FREE accounts, removed immediately for active PLUS members
- Mobile-first Telegram viewport and safe-area behavior

## Repository

```text
apps/
  server/       Fastify API, Telegram webhook and Bot API adapter
  web/          React + TypeScript + Vite Telegram Mini App
packages/
  shared/       Shared API types and formatting utilities
supabase/
  migrations/   PostgreSQL schema, indexes, search function and RLS
ARCHITECTURE.md  Trust boundaries and system flows
DEPLOYMENT.md    Production deployment runbook
```

## Requirements

- Node.js 22+
- pnpm 10+
- A Telegram bot token from BotFather
- A Supabase project
- Two public HTTPS URLs: one for the server and one for the Mini App

## Local setup

```bash
pnpm install
cp .env.example apps/server/.env
printf 'VITE_API_URL=http://localhost:4000\n' > apps/web/.env
pnpm dev
```

Apply the ordered SQL files in `supabase/migrations/` to the Supabase project, then fill all values in `apps/server/.env`. The Mini App cannot receive real Telegram `initData` when opened as a normal localhost tab; open it through Telegram using an HTTPS development tunnel. There is intentionally no mock-login bypass.

Useful checks:

```bash
pnpm typecheck
pnpm test
pnpm build
```

## Telegram bot setup

1. Message `@BotFather` and create a bot with `/newbot`.
2. Put the token in server-only `BOT_TOKEN`.
3. Put the bot username without `@` in `BOT_USERNAME`; it is used for shared-collection bot deep links.
4. Deploy or expose the server and Mini App over HTTPS.
5. Set `MINI_APP_URL` to the deployed web URL.
6. Set a random `TELEGRAM_WEBHOOK_SECRET` of at least 16 characters.
7. Configure the webhook and the bot menu button:

```bash
pnpm --filter @index/server bot:setup https://api.index.example
```

The command registers `https://api.index.example/telegram/webhook` with Telegram's secret-token header and sets the bot's menu button to `MINI_APP_URL`. Configure the Mini App domain in BotFather when prompted by Telegram.

The bot is intentionally not conversational. Unsupported messages are ignored. `/plus` opens the membership screen, `/terms` shows the subscription terms, and `/paysupport DESCRIPTION` creates a payment-support request.

## Membership and advertising

INDEX PLUS is a recurring digital subscription sold through Telegram Stars for **299 Stars every 30 days**. Telegram creates the invoice UI, the server validates the pre-checkout query, and PLUS is granted only after Telegram sends a valid `successful_payment` webhook. Renewal, cancellation, payment history, and entitlement expiry are stored as metadata in Postgres; no payment-card data reaches INDEX.

Telegram's official sponsored messages are placed by Telegram in eligible public bot chats and revenue sharing is controlled by Telegram. They cannot be manually embedded inside a Mini App. INDEX therefore keeps the two surfaces separate:

- the bot chat may receive official Telegram sponsored messages when Telegram marks it eligible;
- the Mini App contains an INDEX-controlled sponsor slot for FREE members;
- INDEX PLUS removes INDEX-controlled sponsored placements.

The initial sponsor slot is a house placement for INDEX PLUS. Connecting a real sponsor or an external ad network is a later commercial integration, not a hidden mock integration.

## Supabase setup

1. Create a Supabase project.
2. Apply every ordered file in `supabase/migrations/`, or link the Supabase CLI and run `supabase db push`.
3. Copy the project URL and **service role** key into the server environment only.
4. Never create a `VITE_SUPABASE_SERVICE_ROLE_KEY`; every `VITE_` variable is browser-visible.

RLS is enabled on every private table. The server service role bypasses RLS by design, so all API operations additionally filter by the internal owner ID derived from the signed session. Critical tests verify this boundary.

## Environment

| Variable | Where | Purpose |
|---|---|---|
| `BOT_TOKEN` | server | Telegram Bot API secret |
| `BOT_USERNAME` | server | Bot username used for reliable shared-collection deep links |
| `TELEGRAM_WEBHOOK_SECRET` | server | Authenticates Telegram webhook requests |
| `MINI_APP_URL` | server | Public HTTPS Mini App URL used by buttons |
| `SUPABASE_URL` | server | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | server | Trusted metadata access; never browser-exposed |
| `SESSION_SECRET` | server | Signs application sessions; minimum 32 characters |
| `WEB_ORIGIN` | server | Allowed Mini App origin; comma-separate additional origins |
| `MAX_UPLOAD_BYTES` | server | Server upload ceiling, default 50 MiB |
| `AUTH_MAX_AGE_SECONDS` | server | Maximum accepted Telegram initData age |
| `VITE_API_URL` | web | Public HTTPS API base URL |

See [.env.example](.env.example) for the complete list.

## Security and privacy

- The browser never supplies or chooses an owner ID.
- Telegram `initData` is HMAC-SHA256 verified with timing-safe comparison and replay age checks.
- Bot webhooks require Telegram's secret header.
- Telegram file IDs and bot tokens never appear in metadata responses.
- Binary endpoints check ownership before resolving a Telegram file path.
- Collection links are random capability tokens; Postgres stores only their SHA-256 hashes. Shared views are read-only, membership-scoped, Telegram-authenticated, and revocable by the owner.
- PLUS checkout payloads are random, short-lived, bound to both internal and Telegram identities, and consumed through an atomic pre-checkout transition.
- Successful Stars charges are stored idempotently by Telegram charge ID. A browser response alone never grants PLUS.
- Upload counts and sizes are limited; filenames and response headers are sanitized.
- Authentication and webhook secrets are redacted from server logs.

INDEX does not claim end-to-end encryption. Telegram bots and the INDEX server necessarily handle files sent to the bot. See [SECURITY.md](SECURITY.md) for reporting guidance.

## Deployment

Build the Mini App as static files and deploy the Node server as a long-running HTTPS service. Apply database migrations before directing Telegram traffic to the webhook. The full sequence and health checks are in [DEPLOYMENT.md](DEPLOYMENT.md).

## License

MIT is recommended for a small, broadly reusable open-source product and is included in [LICENSE](LICENSE).
