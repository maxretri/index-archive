create table public.collection_shares (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index collection_shares_active_collection_idx
  on public.collection_shares (user_id, collection_id)
  where revoked_at is null;

create or replace function public.validate_collection_share_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.collections c
    where c.id = new.collection_id and c.user_id = new.user_id
  ) then
    raise exception 'Shared collection must belong to the same user';
  end if;
  return new;
end;
$$;

create trigger collection_shares_validate_owner
before insert or update of collection_id, user_id on public.collection_shares
for each row execute function public.validate_collection_share_owner();

alter table public.collection_shares enable row level security;

create policy collection_shares_owner_all on public.collection_shares for all
  using (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  with check (user_id = nullif(current_setting('app.user_id', true), '')::uuid);

revoke all on public.collection_shares from anon, authenticated;

comment on table public.collection_shares is
  'Revocable, read-only capability links. Only SHA-256 token hashes are persisted.';
