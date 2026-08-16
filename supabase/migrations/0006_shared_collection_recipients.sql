create table public.collection_share_recipients (
  id uuid primary key default gen_random_uuid(),
  share_id uuid not null references public.collection_shares(id) on delete cascade,
  collection_id uuid not null references public.collections(id) on delete cascade,
  owner_user_id uuid not null references public.users(id) on delete cascade,
  recipient_user_id uuid not null references public.users(id) on delete cascade,
  accepted_at timestamptz not null default now(),
  unique (collection_id, recipient_user_id),
  check (owner_user_id <> recipient_user_id)
);

create index collection_share_recipients_recipient_idx
  on public.collection_share_recipients (recipient_user_id, accepted_at desc);

create or replace function public.validate_collection_share_recipient()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.collection_shares s
    where s.id = new.share_id
      and s.collection_id = new.collection_id
      and s.user_id = new.owner_user_id
      and s.revoked_at is null
  ) then
    raise exception 'Shared collection grant must reference an active matching share';
  end if;
  return new;
end;
$$;

create trigger collection_share_recipients_validate
before insert or update of share_id, collection_id, owner_user_id
on public.collection_share_recipients
for each row execute function public.validate_collection_share_recipient();

alter table public.collection_share_recipients enable row level security;

create policy collection_share_recipients_recipient_select
  on public.collection_share_recipients for select
  using (recipient_user_id = nullif(current_setting('app.user_id', true), '')::uuid);

create policy collection_share_recipients_recipient_delete
  on public.collection_share_recipients for delete
  using (recipient_user_id = nullif(current_setting('app.user_id', true), '')::uuid);

revoke all on public.collection_share_recipients from anon, authenticated;

comment on table public.collection_share_recipients is
  'Accepted Telegram collection invitations shown in each recipient Shared library.';
