# Contributing

Thank you for helping make INDEX better.

1. Open an issue for significant product or architecture changes.
2. Create a focused branch and never commit `.env` files or Telegram/Supabase credentials.
3. Keep Telegram as the primary binary store; migrations should contain metadata only.
4. Preserve the identity invariant: owner IDs come from a verified server session, never browser input.
5. Run `pnpm typecheck`, `pnpm test`, and `pnpm build` before opening a pull request.

Database changes must be additive numbered migrations under `supabase/migrations`. Security-sensitive changes should include tests for unauthenticated access, cross-user access, or signature validation as appropriate.

The interface favors typography, photographs, and precise spacing. Avoid generic dashboard components, heavy icon sets, gradients, glass effects, and decorative cards.
