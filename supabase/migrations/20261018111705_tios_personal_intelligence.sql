-- Persistent, user-owned Personal Intelligence conversations and controls.
-- Proactive findings are deterministic observations. No scheduler or model
-- call runs in the background; observations are checked while T-IOS is open.

create table public.tios_personal_intelligence_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.trading_accounts(id) on delete cascade,
  title text not null default 'New investigation' check (char_length(title) <= 120),
  topic text not null default 'general' check (topic in ('statistics','edge','execution','psychology','general')),
  conversation_kind text not null default 'user' check (conversation_kind in ('user','observation')),
  observation_key text check (observation_key is null or char_length(observation_key) between 1 and 180),
  observation_priority smallint not null default 0 check (observation_priority between 0 and 3),
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  constraint tios_pi_observation_key_check check (
    (conversation_kind = 'observation' and observation_key is not null)
    or (conversation_kind = 'user' and observation_key is null and observation_priority = 0)
  )
);

create unique index tios_pi_conversation_observation_dedupe_idx
  on public.tios_personal_intelligence_conversations (user_id, account_id, observation_key);
create index tios_pi_conversations_account_recent_idx
  on public.tios_personal_intelligence_conversations (user_id, account_id, last_message_at desc);

create table public.tios_personal_intelligence_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.tios_personal_intelligence_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  source text not null check (source in ('user','assistant','local_start','observation')),
  content text not null check (char_length(content) between 1 and 6000),
  evidence_context jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence_context) = 'object'),
  feedback text check (feedback is null or feedback in ('helpful','not_relevant')),
  created_at timestamptz not null default now(),
  constraint tios_pi_message_source_role_check check (
    (role = 'user' and source = 'user')
    or (role = 'assistant' and source in ('assistant','local_start','observation'))
  )
);
create index tios_pi_messages_conversation_time_idx
  on public.tios_personal_intelligence_messages (user_id, conversation_id, created_at, id);

create table public.tios_personal_intelligence_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  proactive_enabled boolean not null default false,
  conversation_frequency text not null default 'balanced' check (conversation_frequency in ('important','balanced','frequent')),
  investigation_focus text not null default 'both' check (investigation_focus in ('edge','execution','both')),
  personalization_enabled boolean not null default true,
  include_trade_evidence boolean not null default true,
  retention_days integer not null default 365 check (retention_days in (30,90,365,0)),
  development_goal text not null default '' check (char_length(development_goal) <= 500),
  updated_at timestamptz not null default now()
);

alter table public.tios_personal_intelligence_conversations enable row level security;
alter table public.tios_personal_intelligence_messages enable row level security;
alter table public.tios_personal_intelligence_preferences enable row level security;

revoke all on public.tios_personal_intelligence_conversations,
  public.tios_personal_intelligence_messages,
  public.tios_personal_intelligence_preferences from public, anon, authenticated;

grant select, insert, delete on public.tios_personal_intelligence_conversations to authenticated;
grant update (title, topic, last_message_at) on public.tios_personal_intelligence_conversations to authenticated;
grant select, insert on public.tios_personal_intelligence_messages to authenticated;
grant update (feedback) on public.tios_personal_intelligence_messages to authenticated;
grant select, insert, update on public.tios_personal_intelligence_preferences to authenticated;

create policy tios_pi_conversations_select_own
  on public.tios_personal_intelligence_conversations for select to authenticated
  using (
    user_id = (select auth.uid())
    and coalesce((select auth.jwt()->>'is_anonymous'),'false') = 'false'
    and exists (
      select 1 from public.trading_accounts a
      where a.id = account_id and a.user_id = (select auth.uid())
    )
  );
create policy tios_pi_conversations_insert_own
  on public.tios_personal_intelligence_conversations for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and coalesce((select auth.jwt()->>'is_anonymous'),'false') = 'false'
    and exists (
      select 1 from public.trading_accounts a
      where a.id = account_id and a.user_id = (select auth.uid())
    )
  );
create policy tios_pi_conversations_update_own
  on public.tios_personal_intelligence_conversations for update to authenticated
  using (
    user_id = (select auth.uid())
    and coalesce((select auth.jwt()->>'is_anonymous'),'false') = 'false'
    and exists (
      select 1 from public.trading_accounts a
      where a.id = account_id and a.user_id = (select auth.uid())
    )
  )
  with check (
    user_id = (select auth.uid())
    and coalesce((select auth.jwt()->>'is_anonymous'),'false') = 'false'
    and exists (
      select 1 from public.trading_accounts a
      where a.id = account_id and a.user_id = (select auth.uid())
    )
  );
create policy tios_pi_conversations_delete_own
  on public.tios_personal_intelligence_conversations for delete to authenticated
  using (
    user_id = (select auth.uid())
    and coalesce((select auth.jwt()->>'is_anonymous'),'false') = 'false'
    and exists (
      select 1 from public.trading_accounts a
      where a.id = account_id and a.user_id = (select auth.uid())
    )
  );

create policy tios_pi_messages_select_own
  on public.tios_personal_intelligence_messages for select to authenticated
  using (
    user_id = (select auth.uid())
    and coalesce((select auth.jwt()->>'is_anonymous'),'false') = 'false'
    and exists (
      select 1 from public.tios_personal_intelligence_conversations c
      where c.id = conversation_id and c.user_id = (select auth.uid())
    )
  );
create policy tios_pi_messages_insert_own
  on public.tios_personal_intelligence_messages for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and coalesce((select auth.jwt()->>'is_anonymous'),'false') = 'false'
    and exists (
      select 1 from public.tios_personal_intelligence_conversations c
      where c.id = conversation_id and c.user_id = (select auth.uid())
    )
  );
create policy tios_pi_messages_update_feedback_own
  on public.tios_personal_intelligence_messages for update to authenticated
  using (
    user_id = (select auth.uid())
    and coalesce((select auth.jwt()->>'is_anonymous'),'false') = 'false'
    and exists (
      select 1 from public.tios_personal_intelligence_conversations c
      where c.id = conversation_id and c.user_id = (select auth.uid())
    )
  )
  with check (
    user_id = (select auth.uid())
    and coalesce((select auth.jwt()->>'is_anonymous'),'false') = 'false'
    and exists (
      select 1 from public.tios_personal_intelligence_conversations c
      where c.id = conversation_id and c.user_id = (select auth.uid())
    )
  );

create policy tios_pi_preferences_select_own
  on public.tios_personal_intelligence_preferences for select to authenticated
  using (user_id = (select auth.uid()) and coalesce((select auth.jwt()->>'is_anonymous'),'false') = 'false');
create policy tios_pi_preferences_insert_own
  on public.tios_personal_intelligence_preferences for insert to authenticated
  with check (user_id = (select auth.uid()) and coalesce((select auth.jwt()->>'is_anonymous'),'false') = 'false');
create policy tios_pi_preferences_update_own
  on public.tios_personal_intelligence_preferences for update to authenticated
  using (user_id = (select auth.uid()) and coalesce((select auth.jwt()->>'is_anonymous'),'false') = 'false')
  with check (user_id = (select auth.uid()) and coalesce((select auth.jwt()->>'is_anonymous'),'false') = 'false');

comment on table public.tios_personal_intelligence_conversations is
  'Private T-IOS Personal Intelligence conversations, scoped to the authenticated user and one of their trading accounts.';
comment on table public.tios_personal_intelligence_messages is
  'Private Personal Intelligence messages and the period evidence snapshot that was available when the message was created.';
comment on table public.tios_personal_intelligence_preferences is
  'Per-user controls for in-app proactive observations, personalization, evidence sharing, and browser-opened retention cleanup.';
