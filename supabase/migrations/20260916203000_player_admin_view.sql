-- Owner-only view joining username + email for admin lookup.
-- security_invoker = true means it runs with the QUERYING role's own
-- permissions, not the view creator's — so it only works for roles that
-- can already read auth.users directly (the dashboard's postgres role).
-- Explicitly revoking anon/authenticated means it is NOT reachable
-- through the public REST API with any client-side key, only through
-- the Supabase Studio dashboard (Table Editor / SQL Editor) or a
-- service_role key.
create view public.player_admin
with (security_invoker = true) as
select p.id, p.username, u.email, p.created_at
from public.profiles p
join auth.users u on u.id = p.id
order by p.created_at desc;

revoke all on public.player_admin from anon, authenticated;
