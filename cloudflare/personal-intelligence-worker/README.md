# T-IOS Personal Intelligence storage

Personal Intelligence conversations and preferences use Cloudflare D1 through this Worker. Existing Supabase sign-in remains the identity source; trade, Playbook, Execution and journal records remain in their current T-IOS stores.

The Worker is an internal storage API. It accepts requests only with `PI_STORAGE_SHARED_SECRET`. The Vercel API route verifies the signed-in Supabase user first, then forwards that user ID to the Worker. Keep the same randomly generated secret in Cloudflare and Vercel; never put it in browser code.

## Provision and deploy

1. Sign in to the intended Cloudflare account with Wrangler and create a D1 database:

   ```sh
   npx wrangler login
   npx wrangler d1 create tios-personal-intelligence
   ```

2. Copy `wrangler.toml.example` to `wrangler.toml`, then replace `database_id` with the ID returned by Wrangler.

3. Apply the schema and set a long random Worker secret:

   ```sh
   npx wrangler d1 migrations apply tios-personal-intelligence --remote
   openssl rand -hex 32
   npx wrangler secret put PI_STORAGE_SHARED_SECRET
   ```

4. Deploy the Worker:

   ```sh
   npx wrangler deploy
   ```

5. Add these **server-only** variables to the Vercel project for Preview and Production:

   - `CLOUDFLARE_PI_STORAGE_URL`: the deployed Worker HTTPS URL.
   - `CLOUDFLARE_PI_STORAGE_SECRET`: the same random secret set on the Worker.

The existing `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` Vercel variables are used only to validate T-IOS sessions. The Cloudflare secret is never sent to the browser. Saved data is scoped by the verified Supabase user ID and the selected T-IOS trading account ID.

This repository does not contain the account-specific D1 database ID or secrets. Until the Worker and Vercel variables are configured, the chat remains session-only and clearly reports that saved history is unavailable.
