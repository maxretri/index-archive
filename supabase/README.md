# Supabase setup

Create a Supabase project, open **SQL Editor**, and run migrations in `migrations/` order. For CLI-managed projects, link the project and run `supabase db push`.

Only the server receives `SUPABASE_SERVICE_ROLE_KEY`. Never place it in `apps/web/.env` or any `VITE_` variable. The browser does not query Supabase directly.

RLS is enabled as defense in depth. The trusted API uses the service role and therefore still scopes every query explicitly by `user_id`; tests cover this ownership invariant.
