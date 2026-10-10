import { createHandler, restDatabase } from './handler.mjs';
// This endpoint uses custom bridge-key authentication, not browser JWT access.
const url = Deno.env.get('SUPABASE_URL');
let key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if (!key) {
  try { key = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default; } catch { /* fail closed */ }
}
Deno.serve(url && key ? createHandler({ database: restDatabase(url, key) }) : () =>
  new Response(JSON.stringify({error:'Server configuration unavailable'}), {status:503,headers:{'Content-Type':'application/json'}}));
