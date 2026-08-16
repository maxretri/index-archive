create extension if not exists pgcrypto;

create type public.index_file_type as enum ('photo', 'video', 'document', 'audio');

create table public.users (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id bigint not null unique,
  first_name text not null,
  last_name text,
  username text,
  language_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  telegram_user_id bigint not null,
  telegram_chat_id bigint not null,
  telegram_message_id bigint not null,
  telegram_file_id text not null,
  telegram_thumbnail_file_id text,
  telegram_file_unique_id text not null,
  file_type public.index_file_type not null,
  mime_type text,
  filename text,
  file_size bigint check (file_size is null or file_size >= 0),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  duration integer check (duration is null or duration >= 0),
  caption text,
  is_favorite boolean not null default false,
  original_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  indexed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_document tsvector generated always as (
    to_tsvector('simple',
      coalesce(filename, '') || ' ' ||
      coalesce(mime_type, '') || ' ' ||
      (case file_type
        when 'photo' then 'photo'
        when 'video' then 'video'
        when 'document' then 'document'
        when 'audio' then 'audio'
      end) || ' ' ||
      coalesce(caption, '')
    )
  ) stored,
  unique (telegram_chat_id, telegram_message_id)
);

create table public.collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

create table public.collection_files (
  collection_id uuid not null references public.collections(id) on delete cascade,
  file_id uuid not null references public.files(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (collection_id, file_id)
);

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table public.file_tags (
  file_id uuid not null references public.files(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (file_id, tag_id)
);

create index files_user_created_idx on public.files (user_id, created_at desc, id desc);
create index files_user_type_created_idx on public.files (user_id, file_type, created_at desc, id desc);
create index files_user_favorite_created_idx on public.files (user_id, created_at desc, id desc) where is_favorite;
create index files_search_idx on public.files using gin (search_document);
create index collection_files_user_file_idx on public.collection_files (user_id, file_id);
create index file_tags_user_file_idx on public.file_tags (user_id, file_id);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger users_set_updated_at before update on public.users
for each row execute function public.set_updated_at();
create trigger files_set_updated_at before update on public.files
for each row execute function public.set_updated_at();
create trigger collections_set_updated_at before update on public.collections
for each row execute function public.set_updated_at();

alter table public.users enable row level security;
alter table public.files enable row level security;
alter table public.collections enable row level security;
alter table public.collection_files enable row level security;
alter table public.tags enable row level security;
alter table public.file_tags enable row level security;

-- The API sets app.user_id only when using a restricted database role. The service
-- role used by the trusted API bypasses RLS, so API queries also explicitly scope user_id.
create policy users_owner_all on public.users for all
  using (id = nullif(current_setting('app.user_id', true), '')::uuid)
  with check (id = nullif(current_setting('app.user_id', true), '')::uuid);
create policy files_owner_all on public.files for all
  using (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  with check (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
create policy collections_owner_all on public.collections for all
  using (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  with check (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
create policy collection_files_owner_all on public.collection_files for all
  using (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  with check (
    user_id = nullif(current_setting('app.user_id', true), '')::uuid
    and exists (select 1 from public.collections c where c.id = collection_id and c.user_id = user_id)
    and exists (select 1 from public.files f where f.id = file_id and f.user_id = user_id)
  );
create policy tags_owner_all on public.tags for all
  using (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  with check (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
create policy file_tags_owner_all on public.file_tags for all
  using (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  with check (
    user_id = nullif(current_setting('app.user_id', true), '')::uuid
    and exists (select 1 from public.tags t where t.id = tag_id and t.user_id = user_id)
    and exists (select 1 from public.files f where f.id = file_id and f.user_id = user_id)
  );

revoke all on all tables in schema public from anon, authenticated;
