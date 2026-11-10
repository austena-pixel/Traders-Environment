# R-IOS routine reminders: development activation

Run these steps only against an isolated development Supabase project. The connected H-IOS database is production and must not be used to activate this feature.

## 1. Apply the migration

Apply `supabase/migrations/20261110130000_routine_notifications.sql` to the development database after the existing Deliberate Routines migration. The migration adds per-user quiet-hours preferences, device push subscriptions, idempotent reminder occurrences, delivery-attempt records, indexes and owner-only RLS policies. It does not change or delete existing routine sessions.

## 2. Configure and deploy the Edge Function

Generate a VAPID key pair with `npx web-push generate-vapid-keys`. Store the private key only as a Supabase Edge Function secret. Set these secrets in the development project:

- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT` (a `mailto:` contact or HTTPS origin)
- `RIOS_SCHEDULER_SECRET` (a long random secret used only by the Cron caller)
- `RIOS_APP_URL` (the development R-IOS origin)

Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to deployed Edge Functions. Deploy `supabase/functions/rios-routine-notifications/index.ts` to the same development project. The public VAPID key endpoint only returns the public key; scheduled delivery requires the private server secret and the scheduler header.

## 3. Store scheduler values and enable Cron

In the development Supabase SQL editor, store the function URL and the same scheduler secret in Vault (replace the placeholders locally; do not commit real values):

```sql
select vault.create_secret(
  'https://YOUR_DEV_PROJECT_REF.supabase.co/functions/v1/rios-routine-notifications',
  'rios_scheduler_url',
  'R-IOS routine reminder endpoint'
);

select vault.create_secret(
  'YOUR_LONG_RANDOM_SCHEDULER_SECRET',
  'rios_scheduler_secret',
  'R-IOS routine reminder Cron authorization'
);
```

Then run `supabase/ops/enable-routine-notification-cron.sql`. It schedules a minute-level UTC job; recurrence and wall-clock times are evaluated in each routine's IANA time zone on the server. The event ledger's unique occurrence key prevents duplicate logical notifications. Delivery attempts are stored per device, with expired endpoints disabled and transient failures retried up to three times.

## Platform behavior

The service worker only handles Web Push display and notification clicks; it does not replace or cache the existing app. H-IOS/R-IOS can show an in-app checklist while open. On iPhone/iPad, Web Push is available only in supported iOS/iPadOS versions when H-IOS is installed on the Home Screen and notification permission is granted by a user action. A PWA cannot display a checklist over another app or over the lock screen. Real push timing depends on browser and operating-system delivery.

The “Test notification” control uses the device's local notification API to verify permission and service-worker display. It does not simulate the server scheduler or guarantee remote delivery.
