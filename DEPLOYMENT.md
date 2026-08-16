# Production deployment

## 1. Database

Create the Supabase project and apply every ordered SQL file in `supabase/migrations/`. Keep the project URL and service-role key for the server deployment.

## 2. Server

Deploy from the repository root using Node.js 22. A generic build/start pair is:

```bash
pnpm install --frozen-lockfile
pnpm --filter @index/shared build
pnpm --filter @index/server build
pnpm --filter @index/server start
```

Set every server variable shown in `.env.example`. Use generated random values for `SESSION_SECRET` and `TELEGRAM_WEBHOOK_SECRET`; do not reuse the bot token. The service must expose port `SERVER_PORT` over HTTPS.

Verify before continuing:

```bash
curl https://api.index.example/health
```

Expected: `{"ok":true,"service":"index-server"}`.

The included `apps/server/Dockerfile` can be built from the repository root:

```bash
docker build -f apps/server/Dockerfile -t index-server .
```

## 3. Mini App

Set `VITE_API_URL=https://api.index.example` at **build time**, then build `apps/web/dist`:

```bash
pnpm --filter @index/web build
```

Deploy that static directory to any HTTPS host. The app uses no server-side rendering and requires no rewrite rules for the current single-page route.

Set the API's `WEB_ORIGIN` to the exact deployed Mini App origin. Use a comma-separated list only when preview and production origins must both work.

## 4. Telegram

Set `MINI_APP_URL` on the server to the deployed Mini App URL, then run:

```bash
pnpm --filter @index/server bot:setup https://api.index.example
```

The command registers the webhook with its secret header, including the `pre_checkout_query` update type, configures the default `OPEN INDEX` menu button, and publishes the payment-support commands. Complete any requested Web App/domain configuration through BotFather.

## 5. Telegram Stars smoke test

Use a dedicated Telegram test account before announcing PLUS publicly:

1. Open `PLUS` in the Mini App and confirm the Telegram invoice says `299 XTR` and renews every 30 days.
2. Complete one real Stars payment; do not treat the invoice callback alone as proof of entitlement.
3. Confirm the Mini App changes to `INDEX PLUS IS ACTIVE`, shows the paid-through date, and removes the internal sponsor slot.
4. Send `/paysupport TEST` and confirm a row appears in `payment_support_requests`.
5. Cancel renewal, verify access remains active until the displayed period end, then resume it.
6. Confirm a repeated `successful_payment` update cannot duplicate `star_payments`.

Telegram's official ad eligibility and sponsored-message delivery are controlled by Telegram and require no ad script in the Mini App. Add real Mini App sponsor inventory only through a separately reviewed commercial integration.

## 6. Smoke test — first magic moment

1. Open the bot and press Start.
2. Forward a photo to it.
3. Confirm the bot replies `SAVED TO INDEX.` exactly once.
4. Tap `OPEN INDEX`.
5. Confirm the photo appears without refreshing.
6. Open it fullscreen, favorite it, close and reopen the app.
7. Find it under Favorites and download the original.

Also verify a second Telegram user cannot retrieve the first user's file UUID through either metadata or binary endpoints.

## Operational notes

- Do not log request bodies in front-end proxies; they can contain Telegram `initData` during authentication.
- Rotate `BOT_TOKEN` immediately if exposed, then rerun the bot setup command.
- Rotate `SESSION_SECRET` to invalidate all app sessions.
- Monitor webhook non-2xx rates and Supabase storage/index growth. Supabase contains metadata, not file binaries.
- Telegram Bot API availability and file limits remain upstream constraints.
