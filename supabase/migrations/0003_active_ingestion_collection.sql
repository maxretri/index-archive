alter table public.users
  add column active_collection_id uuid references public.collections(id) on delete set null;

create index users_active_collection_idx
  on public.users (active_collection_id)
  where active_collection_id is not null;

create or replace function public.validate_active_collection_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.active_collection_id is not null and not exists (
    select 1
    from public.collections c
    where c.id = new.active_collection_id and c.user_id = new.id
  ) then
    raise exception 'Active collection must belong to the same user';
  end if;
  return new;
end;
$$;

create trigger users_validate_active_collection
before insert or update of active_collection_id on public.users
for each row execute function public.validate_active_collection_owner();

comment on column public.users.active_collection_id is
  'Optional virtual collection automatically assigned to files ingested through Telegram or Mini App upload.';
