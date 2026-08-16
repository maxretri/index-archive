create table public.subscriptions (
  user_id uuid primary key references public.users(id) on delete cascade,
  telegram_user_id bigint not null,
  plan text not null default 'plus' check (plan = 'plus'),
  status text not null default 'active' check (status in ('active', 'expired')),
  current_period_end timestamptz not null,
  first_charge_id text not null unique,
  latest_charge_id text not null,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.star_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  telegram_user_id bigint not null,
  telegram_payment_charge_id text not null unique,
  provider_payment_charge_id text,
  invoice_payload text not null,
  currency text not null check (currency = 'XTR'),
  total_amount integer not null check (total_amount > 0),
  subscription_expiration_date timestamptz,
  is_recurring boolean not null default false,
  is_first_recurring boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.subscription_checkout_intents (
  user_id uuid primary key references public.users(id) on delete cascade,
  telegram_user_id bigint not null,
  payload text not null unique check (char_length(payload) between 1 and 128),
  status text not null default 'created' check (status in ('created', 'approved', 'paid')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.payment_support_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  telegram_user_id bigint not null,
  message text not null check (char_length(message) between 1 and 1000),
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index subscriptions_active_idx on public.subscriptions (current_period_end)
  where status = 'active';
create index star_payments_user_created_idx on public.star_payments (user_id, created_at desc);
create index payment_support_open_idx on public.payment_support_requests (created_at)
  where status = 'open';

create or replace function public.validate_payment_user_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.users u
    where u.id = new.user_id and u.telegram_user_id = new.telegram_user_id
  ) then
    raise exception 'Payment identity must match the INDEX user';
  end if;
  return new;
end;
$$;

create trigger subscriptions_validate_identity before insert or update of user_id, telegram_user_id on public.subscriptions
for each row execute function public.validate_payment_user_identity();
create trigger star_payments_validate_identity before insert or update of user_id, telegram_user_id on public.star_payments
for each row execute function public.validate_payment_user_identity();
create trigger payment_support_validate_identity before insert or update of user_id, telegram_user_id on public.payment_support_requests
for each row execute function public.validate_payment_user_identity();
create trigger subscription_checkout_validate_identity before insert or update of user_id, telegram_user_id on public.subscription_checkout_intents
for each row execute function public.validate_payment_user_identity();

create trigger subscriptions_set_updated_at before update on public.subscriptions
for each row execute function public.set_updated_at();
create trigger subscription_checkout_set_updated_at before update on public.subscription_checkout_intents
for each row execute function public.set_updated_at();

alter table public.subscriptions enable row level security;
alter table public.star_payments enable row level security;
alter table public.payment_support_requests enable row level security;
alter table public.subscription_checkout_intents enable row level security;

create policy subscriptions_owner_all on public.subscriptions for all
  using (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  with check (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
create policy star_payments_owner_all on public.star_payments for all
  using (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  with check (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
create policy payment_support_owner_all on public.payment_support_requests for all
  using (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  with check (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
create policy subscription_checkout_owner_all on public.subscription_checkout_intents for all
  using (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  with check (user_id = nullif(current_setting('app.user_id', true), '')::uuid);

revoke all on public.subscriptions, public.star_payments, public.payment_support_requests, public.subscription_checkout_intents from anon, authenticated;

comment on table public.subscriptions is 'Current INDEX PLUS entitlement backed by recurring Telegram Stars payments.';
comment on table public.star_payments is 'Immutable, idempotent audit trail for successful Telegram Stars charges.';
