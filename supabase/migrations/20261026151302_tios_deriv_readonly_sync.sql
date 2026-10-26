-- Start the Deriv MT5 trade feed when a bridge is first enabled, and restart
-- that cutoff when it is reconnected. The sync endpoint uses this timestamp to
-- exclude pre-link deals and positions from the T-IOS journal.
begin;

alter table public.trading_accounts
  add column if not exists mt5_sync_started_at timestamptz;

-- Existing links begin at this migration's cutover. This prevents a first
-- deployment of the bridge from importing account history from before today.
update public.trading_accounts
set mt5_sync_started_at = date_trunc('milliseconds', clock_timestamp()) + interval '1 millisecond'
where platform = 'MT5'
  and broker = 'Deriv'
  and account_type in ('demo', 'real')
  and bridge_enabled = true
  and mt5_sync_started_at is null;

create or replace function public.prepare_mt5_bridge_connection()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.platform = 'MT5'
     and new.broker = 'Deriv'
     and new.account_type in ('demo', 'real') then
    if tg_op = 'INSERT' then
      if new.bridge_enabled then
        new.mt5_sync_started_at := date_trunc('milliseconds', clock_timestamp()) + interval '1 millisecond';
        new.connection_status := 'pending';
      end if;
    elsif new.bridge_enabled and not old.bridge_enabled then
      new.mt5_sync_started_at := date_trunc('milliseconds', clock_timestamp()) + interval '1 millisecond';
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
      -- Prevent a client update from moving the historical cutoff backwards.
      new.mt5_sync_started_at := old.mt5_sync_started_at;
    elsif old.bridge_enabled and not new.bridge_enabled then
      -- A disconnected account must not keep presenting its last live snapshot.
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
    elsif new.bridge_enabled and new.mt5_sync_started_at is null then
      new.mt5_sync_started_at := date_trunc('milliseconds', clock_timestamp()) + interval '1 millisecond';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists prepare_mt5_bridge_connection on public.trading_accounts;
create trigger prepare_mt5_bridge_connection
before insert or update of bridge_enabled, mt5_sync_started_at
on public.trading_accounts
for each row execute function public.prepare_mt5_bridge_connection();

comment on column public.trading_accounts.mt5_sync_started_at is
  'Server-set cutoff for Deriv MT5 trade synchronization; earlier deals and positions are never imported.';

commit;
