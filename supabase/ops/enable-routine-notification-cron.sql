-- Run only in the isolated H-IOS development Supabase project after:
-- 1) applying 20261110130000_routine_notifications.sql,
-- 2) deploying the rios-routine-notifications Edge Function, and
-- 3) storing `rios_scheduler_url` and `rios_scheduler_secret` in Supabase Vault.
-- The SQL deliberately refuses to schedule a job if either Vault secret is absent.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $$
declare
  scheduler_url text;
  scheduler_secret text;
  job_command text;
begin
  select decrypted_secret into scheduler_url
  from vault.decrypted_secrets where name = 'rios_scheduler_url' limit 1;
  select decrypted_secret into scheduler_secret
  from vault.decrypted_secrets where name = 'rios_scheduler_secret' limit 1;

  if scheduler_url is null or scheduler_secret is null then
    raise exception 'Store rios_scheduler_url and rios_scheduler_secret in Supabase Vault before enabling the reminder schedule.';
  end if;

  perform cron.unschedule(jobid) from cron.job where jobname = 'rios-deliberate-routine-notifications';

  job_command := format(
    'select net.http_post(url := %L, headers := jsonb_build_object(''content-type'', ''application/json'', ''x-routine-scheduler-secret'', %L), body := ''{}''::jsonb);',
    scheduler_url,
    scheduler_secret
  );

  perform cron.schedule('rios-deliberate-routine-notifications', '* * * * *', job_command);
end;
$$;
