-- One-time cleanup of disposable evidence verification fixtures only.
-- Storage files were removed through the authenticated Storage API first.
-- This does not change the feature schema or any existing customer records.
do $cleanup$
declare
  qa_ids uuid[];
begin
  select array_agg(id) into qa_ids
  from auth.users
  where raw_user_meta_data->>'tios_evidence_qa' = 'true'
    and email ~ '^tios-evidence-qa-[0-9a-f-]{36}@example[.]com$';
  -- Fresh environments have no QA fixtures; replay is a safe no-op.
  if coalesce(array_length(qa_ids, 1), 0) = 0 then
    return;
  end if;
  if coalesce(array_length(qa_ids, 1), 0) <> 2 then
    raise exception 'Expected exactly two disposable evidence QA users; nothing removed';
  end if;
  if exists (
    select 1 from storage.objects
    where bucket_id = 'trade-setup-evidence'
      and split_part(name, '/', 1) = any (
        select id::text from unnest(qa_ids) as fixture(id)
      )
  ) then
    raise exception 'Fixture Storage files must be removed through Storage API first';
  end if;
  if (select count(*) from public.trades where user_id = any(qa_ids)) <> 2
    or exists (
      select 1 from public.trades
      where user_id = any(qa_ids)
        and (instrument is distinct from 'QA chart fixture'
          or notes is distinct from 'Temporary evidence feature test; not a user trade.')
    )
    or (select count(*) from public.trading_accounts where user_id = any(qa_ids)) <> 1
    or exists (
      select 1 from public.trading_accounts
      where user_id = any(qa_ids)
        and account_name is distinct from 'T-IOS Evidence QA Fixture'
    )
  then
    raise exception 'Disposable fixture data does not match the exact QA records; nothing removed';
  end if;
  delete from auth.users where id = any(qa_ids);
end;
$cleanup$;
