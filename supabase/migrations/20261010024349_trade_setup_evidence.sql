-- Additive migration: existing trades, reviews, numbering and scores are untouched.
create table public.trade_setup_evidence (
  id uuid primary key default gen_random_uuid(),
  schema_version smallint not null default 1 check (schema_version = 1),
  user_id uuid not null references auth.users(id) on delete cascade,
  trade_id uuid not null references public.trades(id) on delete cascade,
  slot smallint not null check (slot between 1 and 3),
  timeframe text not null check (char_length(btrim(timeframe)) between 1 and 32),
  responsibility text not null check (char_length(btrim(responsibility)) between 1 and 120),
  original_path text,
  thumbnail_path text,
  original_name text check (char_length(original_name) between 1 and 180),
  mime_type text check (mime_type in ('image/png','image/jpeg','image/webp')),
  file_size integer check (file_size > 0 and file_size <= 12582912),
  image_width integer check (image_width between 1 and 16384),
  image_height integer check (image_height between 1 and 16384),
  image_uploaded_at timestamptz,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (trade_id, slot),
  check (image_width::bigint * image_height::bigint <= 60000000),
  constraint evidence_image_complete check (
    (original_path is null and thumbnail_path is null and original_name is null and mime_type is null
      and file_size is null and image_width is null and image_height is null and image_uploaded_at is null)
    or (original_path is not null and thumbnail_path is not null and original_name is not null and mime_type is not null
      and file_size is not null and image_width is not null and image_height is not null and image_uploaded_at is not null)
  ),
  constraint evidence_original_owner_path check (
    original_path is null or original_path ~ ('^' || user_id::text || '/' || trade_id::text || '/' || slot::text || '/[0-9a-f-]{36}/original[.](png|jpg|webp)$')
  ),
  constraint evidence_thumbnail_owner_path check (
    thumbnail_path is null or thumbnail_path in (
      user_id::text || '/' || trade_id::text || '/' || slot::text || '/' || split_part(original_path,'/',4) || '/preview.webp',
      user_id::text || '/' || trade_id::text || '/' || slot::text || '/' || split_part(original_path,'/',4) || '/preview.png',
      user_id::text || '/' || trade_id::text || '/' || slot::text || '/' || split_part(original_path,'/',4) || '/preview.jpg'
    )
  )
);
create index trade_setup_evidence_user_trade_idx on public.trade_setup_evidence (user_id, trade_id);
comment on table public.trade_setup_evidence is 'Versioned per-trade visual evidence metadata. Slot order is independent from editable timeframe and responsibility. Originals live in private Storage; no AI observations or scores.';
alter table public.trade_setup_evidence enable row level security;
revoke all on public.trade_setup_evidence from public, anon, authenticated;
grant select, insert, update on public.trade_setup_evidence to authenticated;

create policy evidence_select_own_trade on public.trade_setup_evidence for select to authenticated
using (user_id = (select auth.uid()) and exists (select 1 from public.trades t where t.id = trade_id and t.user_id = (select auth.uid()) and not t.is_deleted));
create policy evidence_insert_own_trade on public.trade_setup_evidence for insert to authenticated
with check (user_id = (select auth.uid()) and exists (select 1 from public.trades t where t.id = trade_id and t.user_id = (select auth.uid()) and not t.is_deleted));
create policy evidence_update_own_trade on public.trade_setup_evidence for update to authenticated
using (user_id = (select auth.uid()) and exists (select 1 from public.trades t where t.id = trade_id and t.user_id = (select auth.uid()) and not t.is_deleted)) with check (user_id = (select auth.uid()) and exists (select 1 from public.trades t where t.id = trade_id and t.user_id = (select auth.uid()) and not t.is_deleted));

-- Immutable ownership and slot identity, with server-managed revisions for optimistic concurrency.
create function public.trade_setup_evidence_revision() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.user_id is distinct from old.user_id or new.trade_id is distinct from old.trade_id
    or new.slot is distinct from old.slot or new.id is distinct from old.id then
    raise exception 'Evidence ownership and chart slot cannot be changed';
  end if;
  new.created_at := old.created_at;
  new.updated_at := now();
  new.revision := old.revision + 1;
  return new;
end;
$$;
revoke all on function public.trade_setup_evidence_revision() from public, anon, authenticated;
create trigger trade_setup_evidence_revision before update on public.trade_setup_evidence
for each row execute function public.trade_setup_evidence_revision();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('trade-setup-evidence', 'trade-setup-evidence', false, 12582912, array['image/png','image/jpeg','image/webp']);

-- New filenames per replacement: no UPDATE policy and no in-place Storage upserts.
create policy evidence_objects_select on storage.objects for select to authenticated
using (bucket_id = 'trade-setup-evidence' and split_part(name, '/', 1) = (select auth.uid())::text and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[1-3]/[0-9a-f-]{36}/(original|preview)[.](png|jpg|webp)$' and exists (select 1 from public.trades t where t.id = case when split_part(name, '/', 2) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then split_part(name, '/', 2)::uuid else null end and t.user_id = (select auth.uid()) and not t.is_deleted));
create policy evidence_objects_insert on storage.objects for insert to authenticated
with check (bucket_id = 'trade-setup-evidence' and split_part(name, '/', 1) = (select auth.uid())::text and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[1-3]/[0-9a-f-]{36}/(original|preview)[.](png|jpg|webp)$' and exists (select 1 from public.trades t where t.id = case when split_part(name, '/', 2) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then split_part(name, '/', 2)::uuid else null end and t.user_id = (select auth.uid()) and not t.is_deleted));
create policy evidence_objects_delete on storage.objects for delete to authenticated
using (bucket_id = 'trade-setup-evidence' and split_part(name, '/', 1) = (select auth.uid())::text and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[1-3]/[0-9a-f-]{36}/(original|preview)[.](png|jpg|webp)$' and exists (select 1 from public.trades t where t.id = case when split_part(name, '/', 2) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then split_part(name, '/', 2)::uuid else null end and t.user_id = (select auth.uid()) and not t.is_deleted));

