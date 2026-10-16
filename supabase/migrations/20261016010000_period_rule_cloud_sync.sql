-- Stage 1: cloud persistence for account-scoped period Rules responses.
-- Preserve the existing TIOSPeriodRules serialized schema; individual-trade
-- execution checks and quantitative scores remain in their original tables.
create table if not exists public.tios_period_rule_reviews (
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.trading_accounts(id) on delete cascade,
  review_key text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, account_id, review_key),
  constraint tios_period_review_key_length check (char_length(review_key) between 1 and 3000),
  constraint tios_period_review_payload_valid check (
    jsonb_typeof(payload) = 'object'
    and payload->>'schema' = 'tios.period-rule-review.v1'
    and payload->>'userId' = user_id::text
    and payload->>'accountId' = account_id::text
    and payload->>'key' = review_key
    and payload->>'ruleScope' in ('session','daily','weekly','monthly')
    and jsonb_typeof(payload->'answers') = 'array'
    and octet_length(payload::text) <= 524288
  )
);

alter table public.tios_period_rule_reviews enable row level security;
create policy "period_reviews_select_owned_account"
  on public.tios_period_rule_reviews for select to authenticated
  using (user_id = (select auth.uid()) and exists (
    select 1 from public.trading_accounts a
    where a.id = account_id and a.user_id = (select auth.uid())
  ));
create policy "period_reviews_insert_owned_account"
  on public.tios_period_rule_reviews for insert to authenticated
  with check (user_id = (select auth.uid()) and exists (
    select 1 from public.trading_accounts a
    where a.id = account_id and a.user_id = (select auth.uid())
  ));
create policy "period_reviews_update_owned_account"
  on public.tios_period_rule_reviews for update to authenticated
  using (user_id = (select auth.uid()) and exists (
    select 1 from public.trading_accounts a
    where a.id = account_id and a.user_id = (select auth.uid())
  ))
  with check (user_id = (select auth.uid()) and exists (
    select 1 from public.trading_accounts a
    where a.id = account_id and a.user_id = (select auth.uid())
  ));
grant select, insert, update on public.tios_period_rule_reviews to authenticated;
