-- Additive native analysis storage. Existing preferences, trades and MT5 data
-- remain unchanged. Empty indicator/drawing arrays are authoritative removals.
create function public.valid_chart_workspace_analysis(doc jsonb) returns boolean
language plpgsql immutable security invoker set search_path = '' as $$
declare
  pane_key text; p jsonb; market_key text; c jsonb; item jsonb; point jsonb;
  timeframe text; view_range jsonb; item_ids text[]; field text;
begin
  if doc is null or jsonb_typeof(doc) is distinct from 'object'
    or octet_length(doc::text)>400000 then return false; end if;
  if (select count(*) from jsonb_object_keys(doc))<>2
    or not doc ?& array['version','panes'] or doc->'version' is distinct from '1'::jsonb
    or jsonb_typeof(doc->'panes') is distinct from 'object' then return false; end if;
  if (select count(*) from jsonb_object_keys(doc->'panes'))>25 then return false; end if;
  for pane_key,p in select key,value from jsonb_each(doc->'panes') loop
    if pane_key !~ '^[a-z0-9_-]{1,80}$' or pane_key in ('__proto__','prototype','constructor')
      or jsonb_typeof(p) is distinct from 'object' then return false; end if;
    if (select count(*) from jsonb_object_keys(p))<>4
      or not p ?& array['engine','market','interval','contexts']
      or jsonb_typeof(p->'engine') is distinct from 'string' or p->>'engine' not in ('native','tradingview')
      or jsonb_typeof(p->'market') is distinct from 'string' or p->>'market' not in ('v75_1s','v75')
      or jsonb_typeof(p->'interval') is distinct from 'string' or p->>'interval' not in ('1','3','5','15','30','60','120','240','D')
      or jsonb_typeof(p->'contexts') is distinct from 'object' then return false; end if;
    for market_key,c in select key,value from jsonb_each(p->'contexts') loop
      if market_key not in ('v75_1s','v75') or jsonb_typeof(c) is distinct from 'object' then return false; end if;
      if (select count(*) from jsonb_object_keys(c))<>3 or not c ?& array['drawings','indicators','views']
        or jsonb_typeof(c->'drawings') is distinct from 'array'
        or jsonb_typeof(c->'indicators') is distinct from 'array'
        or jsonb_typeof(c->'views') is distinct from 'object' then return false; end if;
      if jsonb_array_length(c->'drawings')>200 or jsonb_array_length(c->'indicators')>25 then return false; end if;
      foreach field in array array['drawings','indicators'] loop
        item_ids:=array[]::text[];
        for item in select value from jsonb_array_elements(c->field) loop
          if jsonb_typeof(item) is distinct from 'object' then return false; end if;
          if jsonb_typeof(item->'id') is distinct from 'string' or item->>'id' !~ '^[a-z0-9_-]{1,80}$'
            or item->>'id' in ('__proto__','prototype','constructor') or item->>'id'=any(item_ids)
            or jsonb_typeof(item->'color') is distinct from 'string' or item->>'color' !~ '^#[0-9a-fA-F]{6}$'
            or jsonb_typeof(item->'type') is distinct from 'string' then return false; end if;
          item_ids:=array_append(item_ids,item->>'id');
          if field='drawings' then
            if (select count(*) from jsonb_object_keys(item))<>5 or not item ?& array['id','type','points','color','text']
              or item->>'type' not in ('level','trend','rectangle','text')
              or jsonb_typeof(item->'text') is distinct from 'string' or char_length(item->>'text')>240
              or jsonb_typeof(item->'points') is distinct from 'array' then return false; end if;
            if jsonb_array_length(item->'points')<>(case when item->>'type' in ('trend','rectangle') then 2 else 1 end) then return false; end if;
            for point in select value from jsonb_array_elements(item->'points') loop
              if jsonb_typeof(point) is distinct from 'object' then return false; end if;
              if (select count(*) from jsonb_object_keys(point))<>2 or not point ?& array['time','price']
                or jsonb_typeof(point->'time') is distinct from 'number' or jsonb_typeof(point->'price') is distinct from 'number'
                or (point->>'time')::numeric<>trunc((point->>'time')::numeric)
                or (point->>'time')::numeric<=0 or (point->>'time')::numeric>=8640000000000
                or (point->>'price')::numeric<=0 then return false; end if;
            end loop;
          else
            if (select count(*) from jsonb_object_keys(item))<>4 or not item ?& array['id','type','period','color']
              or item->>'type' not in ('sma','ema') or jsonb_typeof(item->'period') is distinct from 'number'
              or (item->>'period')::numeric<>trunc((item->>'period')::numeric)
              or (item->>'period')::numeric not between 2 and 500 then return false; end if;
          end if;
        end loop;
      end loop;
      for timeframe,view_range in select key,value from jsonb_each(c->'views') loop
        if timeframe not in ('1','3','5','15','30','60','120','240','D') or jsonb_typeof(view_range) is distinct from 'object' then return false; end if;
        if (select count(*) from jsonb_object_keys(view_range))<>2 or not view_range ?& array['from','to']
          or jsonb_typeof(view_range->'from') is distinct from 'number' or jsonb_typeof(view_range->'to') is distinct from 'number'
          or (view_range->>'from')::numeric<>trunc((view_range->>'from')::numeric)
          or (view_range->>'to')::numeric<>trunc((view_range->>'to')::numeric)
          or (view_range->>'from')::numeric<=0 or (view_range->>'to')::numeric<=(view_range->>'from')::numeric
          or (view_range->>'to')::numeric>=8640000000000 then return false; end if;
      end loop;
    end loop;
  end loop;
  return true;
exception when others then return false;
end;
$$;
revoke all on function public.valid_chart_workspace_analysis(jsonb) from public,anon,authenticated;
grant execute on function public.valid_chart_workspace_analysis(jsonb) to authenticated;

create table public.chart_workspace_analysis (
  user_id uuid primary key references public.chart_workspace_profiles(user_id) on delete cascade,
  content jsonb not null check (public.valid_chart_workspace_analysis(content)),
  revision integer not null default 1 check (revision>0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.chart_workspace_analysis enable row level security;
revoke all on public.chart_workspace_analysis from public,anon,authenticated;
grant select on public.chart_workspace_analysis to authenticated;
grant insert (user_id,content),update (content) on public.chart_workspace_analysis to authenticated;
create policy chart_analysis_select_own on public.chart_workspace_analysis
  for select to authenticated using ((select auth.uid())=user_id);
create policy chart_analysis_insert_own on public.chart_workspace_analysis
  for insert to authenticated with check ((select auth.uid())=user_id and coalesce((select auth.jwt()->>'is_anonymous'),'false')='false');
create policy chart_analysis_update_own on public.chart_workspace_analysis
  for update to authenticated using ((select auth.uid())=user_id)
  with check ((select auth.uid())=user_id and coalesce((select auth.jwt()->>'is_anonymous'),'false')='false');

create function public.chart_workspace_analysis_revision() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op='INSERT' then new.revision:=1;new.created_at:=now();
  else
    if new.user_id is distinct from old.user_id then raise exception 'Analysis ownership cannot change';end if;
    new.revision:=old.revision+1;new.created_at:=old.created_at;
  end if;
  new.updated_at:=now();return new;
end;
$$;
revoke all on function public.chart_workspace_analysis_revision() from public,anon,authenticated;
create trigger chart_workspace_analysis_revision before insert or update on public.chart_workspace_analysis
  for each row execute function public.chart_workspace_analysis_revision();
comment on table public.chart_workspace_analysis is 'Private native chart state per registered T-IOS Charts user. Pane/instrument scoped drawings, SMA/EMA configuration and view ranges. Revision guarded writes; no TradingView credentials, widget state, trading execution or market data.';
