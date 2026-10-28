-- Add read-only MT4 synchronization without changing the existing MT5 bridge.
begin;

alter table public.trading_accounts
  add column if not exists mt4_login text,
  add column if not exists mt4_server text,
  add column if not exists mt4_sync_started_at timestamptz;

alter table public.trades
  add column if not exists external_trade_id text;

alter table public.trades
  drop constraint if exists trades_source_check;

alter table public.trades
  add constraint trades_source_check
  check (source = any (array['manual'::text, 'mt4'::text, 'mt5'::text]));

-- NULL values remain available to manual and existing MT5 rows. The bridge
-- upserts MT4 rows using account + source + the MT4 order ticket.
create unique index if not exists trades_account_source_external_trade_uidx
  on public.trades (account_id, source, external_trade_id);

update public.trading_accounts
set mt4_sync_started_at = date_trunc('milliseconds', clock_timestamp()) + interval '1 millisecond'
where platform = 'MT4'
  and broker = 'Deriv'
  and account_type in ('demo', 'real')
  and bridge_enabled = true
  and mt4_sync_started_at is null;

create or replace function public.prepare_mt4_bridge_connection()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.platform = 'MT4'
     and new.broker = 'Deriv'
     and new.account_type in ('demo', 'real') then
    if tg_op = 'INSERT' then
      if new.bridge_enabled then
        new.mt4_sync_started_at := date_trunc('milliseconds', clock_timestamp()) + interval '1 millisecond';
        new.connection_status := 'pending';
      end if;
    elsif new.bridge_enabled and not old.bridge_enabled then
      new.mt4_sync_started_at := date_trunc('milliseconds', clock_timestamp()) + interval '1 millisecond';
      new.connection_status := 'pending';
      new.last_sync_at := null;
      new.current_balance := null;
      new.current_equity := null;
      new.floating_pnl := null;
      new.margin := null;
      new.free_margin := null;
      new.margin_level := null;
      new.open_positions := null;
      new.sync_error := null;
    elsif new.bridge_enabled and old.bridge_enabled then
      -- Keep the server-set cutoff stable while this connection remains linked.
      new.mt4_sync_started_at := old.mt4_sync_started_at;
    elsif old.bridge_enabled and not new.bridge_enabled then
      -- A disconnected account must not keep presenting its previous snapshot.
      new.connection_status := 'offline';
      new.last_sync_at := null;
      new.current_balance := null;
      new.current_equity := null;
      new.floating_pnl := null;
      new.margin := null;
      new.free_margin := null;
      new.margin_level := null;
      new.open_positions := null;
      new.sync_error := null;
    elsif new.bridge_enabled and new.mt4_sync_started_at is null then
      new.mt4_sync_started_at := date_trunc('milliseconds', clock_timestamp()) + interval '1 millisecond';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists prepare_mt4_bridge_connection on public.trading_accounts;
create trigger prepare_mt4_bridge_connection
before insert or update of bridge_enabled, mt4_sync_started_at
on public.trading_accounts
for each row execute function public.prepare_mt4_bridge_connection();

comment on column public.trading_accounts.mt4_sync_started_at is
  'Server-set cutoff for Deriv MT4 trade synchronization; earlier orders are never imported.';
comment on column public.trades.external_trade_id is
  'Platform-neutral broker trade identifier used by read-only broker sync bridges.';

commit;