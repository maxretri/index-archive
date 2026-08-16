# INDEX Architecture

INDEX is a private Telegram-native archive. Telegram transports and stores binaries, PostgreSQL stores the searchable index, and the Mini App presents the library.

## System boundaries

```text
Telegram user
  ├─ sends/forwards media ──> Telegram Bot API ──> POST /telegram/webhook
  └─ opens Mini App ────────> React/Vite ────────> POST /auth/telegram
                                                    │
                                        verified app session
                                                    │
                                  authenticated /api requests
                                                    │
                    Fastify server ────────> Supabase PostgreSQL
                          │                       (metadata only)
                          └───────────────> Telegram Bot API
                                           (binary stream/upload)
```

The server is the only trusted application component. It owns the bot token, Supabase service-role key, and session secret. The browser receives none of them.

## Identity and authorization

1. Telegram injects `initData` when the Mini App opens.
2. The browser sends the opaque string to `POST /auth/telegram`.
3. The server calculates Telegram's HMAC-SHA256 signature, uses a timing-safe comparison, checks `auth_date`, and parses the signed user object.
4. The server upserts a local user and issues a short-lived signed application session.
5. Authentication middleware derives the internal user ID from that session. API handlers never accept a browser-supplied owner ID.
6. Every metadata query includes the authenticated internal user ID. PostgreSQL RLS policies provide a second boundary for clients using a user-scoped `app.user_id` claim.

The webhook independently trusts only Telegram requests carrying the configured secret webhook header. It derives identity from the Bot API update, not request parameters.

## Data model

- `users`: Telegram identity and profile metadata.
- `files`: one indexed Telegram message/file, including Telegram retrieval IDs, type-specific metadata, search text, and favorite state.
- `collections`: user-owned virtual groupings.
- `collection_files`: many-to-many membership with ownership duplicated for enforceable RLS.
- `collection_shares`: revocable read-only collection capabilities; only SHA-256 token hashes are stored.
- `tags` and `file_tags`: normalized user-owned tags and memberships.
- `subscription_checkout_intents`: short-lived, identity-bound Telegram Stars checkout state.
- `star_payments`: immutable idempotency and audit records for confirmed Stars charges.
- `subscriptions`: current PLUS entitlement, renewal date, and cancellation state.
- `payment_support_requests`: user-submitted payment cases from `/paysupport`.

Original binaries are never stored in Supabase. `files.telegram_file_id` points to the Telegram-hosted binary. A smaller Telegram photo size or media thumbnail is retained as `telegram_thumbnail_file_id` for grid requests.

## Core flows

### Bot ingestion

The webhook accepts private-chat `photo`, `video`, `document`, and `audio` messages. It normalizes the largest photo or attached file, upserts the Telegram user, inserts metadata idempotently using `(telegram_chat_id, telegram_message_id)`, then replies `SAVED TO INDEX.` with an `OPEN INDEX` Mini App button.

### Library read

The Mini App requests cursor-paginated metadata. Photo and video grids load authenticated thumbnail URLs lazily. The content endpoint verifies ownership before resolving the Telegram file path and streaming the binary with private caching. Full originals are requested only in viewers or downloads.

### Mini App upload

The browser uploads one file with progress to the authenticated server. The server validates size/type, streams it to Telegram with `sendPhoto`, `sendVideo`, `sendAudio`, or `sendDocument`, then indexes the returned message exactly like webhook ingestion. Telegram remains the canonical binary store.

### Collection sharing

The owner creates a random 256-bit collection capability and uses Telegram's prepared-message recipient picker to share a Main Mini App deep link. The raw token appears only in that link; PostgreSQL stores its SHA-256 hash. A recipient still authenticates through signed Telegram `initData`, then receives read-only, cursor-paginated metadata. Shared binary reads validate the active capability, collection membership, and file owner before resolving Telegram storage. `STOP SHARING` revokes every active capability for the collection immediately.

### INDEX PLUS through Telegram Stars

The authenticated Mini App asks the server for a recurring 299 XTR invoice. The server creates a random checkout payload bound to the internal user and signed Telegram user, persists a 15-minute intent, then asks Telegram for an invoice link with a 30-day subscription period. Telegram displays and owns the payment interface.

Before charging, Telegram sends `pre_checkout_query` to the secret-protected webhook. The server revalidates currency, amount, both identities, expiry, and current entitlement, then atomically marks the intent approved. Only a subsequent `successful_payment` update creates an idempotent charge record and extends PLUS to Telegram's reported subscription expiration. Cancel/resume operations use the first Telegram charge ID and never modify entitlement merely from browser state.

Official Telegram sponsored messages and Mini App sponsorship are separate. Telegram controls official ads in eligible bot chats. The web application can only render its own sponsor inventory; this first-party slot is visible to FREE accounts and absent for active PLUS accounts.

## Performance

- Keyset cursor pagination on `(created_at, id)` avoids offset degradation.
- Stable aspect-ratio metadata reserves photo grid space.
- Native lazy image loading plus incremental fetching avoids full-library downloads.
- Telegram thumbnails are used for grids; originals are streamed on demand.
- Search uses a generated PostgreSQL `tsvector` plus indexed structured fields.

## Future semantic search

`files.search_text` is the stable metadata corpus. Later workers can add extraction and embedding tables keyed by `file_id` without changing ingestion, ownership, or the public library API. No AI processing is part of the MVP.

## Deployment shape

- `apps/web`: static Vite build on Vercel, Netlify, Cloudflare Pages, or any HTTPS static host.
- `apps/server`: long-running HTTPS Node service on Render, Fly.io, Railway, or similar.
- `supabase/migrations`: PostgreSQL schema and RLS applied to a Supabase project.
- Telegram webhook: points to the public server `/telegram/webhook`; the bot menu button and inline button point to the public Mini App URL.
