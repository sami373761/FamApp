-- =============================================================================
-- Least privilege for the Data API roles
--
-- Supabase's default privileges for the `public` schema grant ALL on every new
-- table and function to `anon`, `authenticated` and `service_role` at creation
-- time. Those are *explicit* grants to each role, so the earlier
-- `revoke ... from public` did not touch them, and the tables ended up with:
--
--   anon, authenticated: DELETE INSERT REFERENCES SELECT TRIGGER TRUNCATE UPDATE
--
-- Two problems. `anon` needs nothing at all — every RPC rejects an unauthenticated
-- caller and every policy is `to authenticated`, so anon was already reaching
-- zero rows, but the grants should not be there. And TRUNCATE is *not* subject
-- to row level security: a role holding it can empty a table outright,
-- regardless of policies. PostgREST never emits TRUNCATE, so this was not
-- reachable through the API, but it has no business being granted.
--
-- Revoke everything, then re-grant exactly the four verbs the app uses.
-- `service_role` keeps full access by design — it is the trusted backend role.
-- =============================================================================

-- anon: no access to application data whatsoever.
revoke all on public.families  from anon;
revoke all on public.profiles  from anon;
revoke all on public.locations from anon;
revoke all on public.messages  from anon;
revoke all on public.tasks     from anon;

revoke all on function public.create_family(varchar) from anon;
revoke all on function public.join_family(varchar)   from anon;
revoke all on function public.remove_member(uuid)    from anon;

-- authenticated: DML only. No TRUNCATE, TRIGGER or REFERENCES.
revoke all on public.families  from authenticated;
revoke all on public.profiles  from authenticated;
revoke all on public.locations from authenticated;
revoke all on public.messages  from authenticated;
revoke all on public.tasks     from authenticated;

grant select, update, delete         on public.families  to authenticated;
grant select, insert, update, delete on public.profiles  to authenticated;
grant select, insert, update, delete on public.locations to authenticated;
grant select, insert, update, delete on public.messages  to authenticated;
grant select, insert, update, delete on public.tasks     to authenticated;

-- Stop the same default privileges from re-granting on anything added later.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on functions from anon;

-- Note: the `extension_in_public` advisor warning for pg_net is left as-is.
-- pg_net does not support ALTER EXTENSION ... SET SCHEMA, and every object it
-- owns already lives in the `net` schema — only the extension's recorded
-- namespace is `public`, which exposes nothing through PostgREST.
