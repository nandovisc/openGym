-- openGym on Supabase (STORE=supabase): schema, tables and the RPCs api/store/remote.js calls.
--
-- Safe to run more than once. Everything lives in the `opengym` schema, which only the functions
-- below can reach: RLS on, no policy, no grant to anon or authenticated. The functions sit in
-- `public` so PostgREST exposes them without touching PGRST_DB_SCHEMAS, run as their owner
-- (SECURITY DEFINER, fixed search_path) and can be executed by service_role alone — the key the
-- API holds server-side, never the browser.
--
-- Apply:  docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < api/store/supabase.sql

create schema if not exists opengym;
revoke all on schema opengym from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on schema opengym from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on schema opengym from authenticated'; end if;
end $$;

-- db.json, the WebAuthn challenges, the pairing codes, the live-workout rows, the cookie secret
-- and the VAPID keys: one row each. `value` is text, not jsonb, so a document reads back byte for
-- byte as it was written (jsonb reorders keys).
create table if not exists opengym.kv (
  key text primary key,
  value text not null,
  version bigint not null default 1,
  updated_at timestamptz not null default now()
);
-- state-<uid>.json: one profile's whole document.
create table if not exists opengym.states (
  uid text primary key,
  doc text not null,
  version bigint not null default 1,
  updated_at timestamptz not null default now()
);
-- audit.log: one row per event; `id` is the event id the admin dashboard pages by.
create table if not exists opengym.audit (
  id bigserial primary key,
  ts bigint not null,
  rec jsonb not null
);
create index if not exists audit_ts on opengym.audit (ts);
-- uploads/<uid>/ and its .gc.json: which files a profile has, and since when each one has gone
-- unreferenced. The bytes are in the Storage bucket `opengym-media`, at <uid>/<hash>.<ext>.
create table if not exists opengym.media (
  uid text not null,
  hash text not null,
  ext text not null,
  size bigint not null,
  unref_since bigint,
  created_at timestamptz not null default now(),
  primary key (uid, hash)
);
-- Rest-timer alerts waiting to be sent, one per profile and device (`key`).
create table if not exists opengym.push_queue (
  key text primary key,
  uid text not null,
  device text,
  due_at timestamptz not null,
  payload jsonb not null
);
create index if not exists push_queue_due on opengym.push_queue (due_at);

alter table opengym.kv enable row level security;
alter table opengym.states enable row level security;
alter table opengym.audit enable row level security;
alter table opengym.media enable row level security;
alter table opengym.push_queue enable row level security;

-- ---------------------------------------------------------------- boot

-- The cookie-signing secret and the VAPID keys: the ones offered are kept only when none is
-- stored yet, so every instance, cold start and redeploy signs with the same secret.
create or replace function public.opengym_bootstrap(p_secret text, p_vapid text)
returns jsonb language plpgsql security definer set search_path = opengym, pg_temp as $$
begin
  insert into kv (key, value) values ('secret', p_secret) on conflict (key) do nothing;
  insert into kv (key, value) values ('vapid', p_vapid) on conflict (key) do nothing;
  return jsonb_build_object(
    'secret', (select value from kv where key = 'secret'),
    'vapid', (select value from kv where key = 'vapid'));
end $$;

-- ---------------------------------------------------------------- one request

create or replace function public.opengym_load()
returns jsonb language sql stable security definer set search_path = opengym, pg_temp as $$
  select coalesce(jsonb_object_agg(key, jsonb_build_object('value', value, 'version', version)), '{}'::jsonb)
  from kv where key in ('db', 'challenges', 'pairings', 'presence');
$$;

-- A profile's document. `p_have` is the version the caller already holds: then only the version
-- comes back, not a document that can be megabytes.
create or replace function public.opengym_state(p_uid text, p_have bigint)
returns jsonb language sql stable security definer set search_path = opengym, pg_temp as $$
  select coalesce(
    (select jsonb_build_object('version', version, 'doc', case when version = p_have then null else doc end)
       from states where uid = p_uid),
    jsonb_build_object('version', 0));
$$;

-- Everything one request changed, all or nothing. A row is written only while it is still at
-- the version the request read (0 = it did not exist); otherwise nothing is and {ok:false} tells
-- the caller to run the request again. A state with version null is written whatever is there.
create or replace function public.opengym_commit(p jsonb)
returns jsonb language plpgsql security definer set search_path = opengym, pg_temp as $$
declare
  r jsonb;
  n int;
  v bigint;
  out_states jsonb := '{}'::jsonb;
begin
  for r in select * from jsonb_array_elements(coalesce(p->'kv', '[]'::jsonb)) loop
    if coalesce((r->>'version')::bigint, 0) = 0 then
      insert into kv (key, value) values (r->>'key', r->>'value') on conflict (key) do nothing;
    else
      update kv set value = r->>'value', version = version + 1, updated_at = now()
       where key = r->>'key' and version = (r->>'version')::bigint;
    end if;
    get diagnostics n = row_count;
    if n = 0 then raise exception using errcode = '40001', message = 'opengym: newer write'; end if;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p->'states', '[]'::jsonb)) loop
    if r->'doc' is null or jsonb_typeof(r->'doc') = 'null' then
      delete from states where uid = r->>'uid';
      continue;
    end if;
    if r->'version' is null or jsonb_typeof(r->'version') = 'null' then
      insert into states (uid, doc) values (r->>'uid', r->>'doc')
        on conflict (uid) do update set doc = excluded.doc, version = states.version + 1, updated_at = now()
        returning version into v;
    elsif (r->>'version')::bigint = 0 then
      insert into states (uid, doc) values (r->>'uid', r->>'doc') on conflict (uid) do nothing
        returning version into v;
    else
      update states set doc = r->>'doc', version = version + 1, updated_at = now()
       where uid = r->>'uid' and version = (r->>'version')::bigint
       returning version into v;
    end if;
    get diagnostics n = row_count;
    if n = 0 then raise exception using errcode = '40001', message = 'opengym: newer write'; end if;
    out_states := out_states || jsonb_build_object(r->>'uid', v);
  end loop;

  insert into audit (ts, rec)
    select coalesce((e->>'ts')::bigint, (extract(epoch from now()) * 1000)::bigint), e
      from jsonb_array_elements(coalesce(p->'audit', '[]'::jsonb)) e;

  for r in select * from jsonb_array_elements(coalesce(p->'push', '[]'::jsonb)) loop
    if r->>'op' = 'set' then
      insert into push_queue (key, uid, device, due_at, payload)
        values (r->>'key', r->>'uid', r->>'device', to_timestamp((r->>'due')::double precision / 1000), r->'payload')
        on conflict (key) do update set due_at = excluded.due_at, payload = excluded.payload, device = excluded.device;
    elsif r->>'op' = 'cancel' then
      if r->>'key' is not null then delete from push_queue where key = r->>'key';
      else delete from push_queue where uid = r->>'uid';
      end if;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'states', out_states);
exception when serialization_failure then
  return jsonb_build_object('ok', false);
end $$;

-- ---------------------------------------------------------------- audit log

-- One page of the admin's activity log, newest first: retention (age, then the newest p_max)
-- first, then the category, then the page. Same order of operations as auditKeep() + the route.
create or replace function public.opengym_audit_list(p_before bigint, p_limit int, p_cat text, p_cut bigint, p_max int)
returns jsonb language sql stable security definer set search_path = opengym, pg_temp as $$
  with kept as (
    select id, rec from audit
     where p_cut = 0 or ts >= p_cut
     order by id desc
     limit case when p_max > 0 then p_max else null end
  ), cat as (
    select id, rec from kept
     where p_cat = '' or (p_cat = 'fail' and coalesce((rec->>'ok')::boolean, true) = false)
        or (p_cat not in ('', 'fail') and rec->>'ev' like p_cat || '.%')
  ), page as (
    select id, rec from cat where id < p_before order by id desc limit p_limit
  )
  select jsonb_build_object(
    'total', (select count(*) from cat),
    'events', coalesce((select jsonb_agg(rec || jsonb_build_object('id', id) order by id desc) from page), '[]'::jsonb));
$$;

create or replace function public.opengym_audit_clear()
returns void language sql security definer set search_path = opengym, pg_temp as $$
  delete from audit;
$$;

create or replace function public.opengym_audit_compact(p_cut bigint, p_max int)
returns void language plpgsql security definer set search_path = opengym, pg_temp as $$
begin
  if p_cut > 0 then delete from audit where ts < p_cut; end if;
  if p_max > 0 then
    delete from audit where id < (select min(id) from (select id from audit order by id desc limit p_max) k);
  end if;
end $$;

-- ---------------------------------------------------------------- rest-timer pushes

-- Every alert that is due, taken off the queue in the same statement, so two ticks that overlap
-- cannot both send one.
create or replace function public.opengym_push_take()
returns jsonb language sql security definer set search_path = opengym, pg_temp as $$
  with due as (delete from push_queue where due_at <= now() returning uid, device, payload)
  select coalesce(jsonb_agg(jsonb_build_object('uid', uid, 'device', device, 'payload', payload)), '[]'::jsonb) from due;
$$;

-- ---------------------------------------------------------------- media

create or replace function public.opengym_media_list(p_uid text)
returns jsonb language sql stable security definer set search_path = opengym, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('hash', hash, 'ext', ext, 'size', size, 'unref', unref_since) order by created_at), '[]'::jsonb)
    from media where uid = p_uid;
$$;

create or replace function public.opengym_media_put(p_uid text, p_hash text, p_ext text, p_size bigint, p_unref bigint)
returns void language sql security definer set search_path = opengym, pg_temp as $$
  insert into media (uid, hash, ext, size, unref_since) values (p_uid, p_hash, p_ext, p_size, p_unref)
    on conflict (uid, hash) do update set ext = excluded.ext, size = excluded.size, unref_since = excluded.unref_since;
$$;

-- The grace clocks of a profile's files: {hash: ms since unreferenced, or null when referenced}.
create or replace function public.opengym_media_marks(p_uid text, p_marks jsonb)
returns void language sql security definer set search_path = opengym, pg_temp as $$
  update media m set unref_since = case when jsonb_typeof(p_marks->m.hash) = 'number' then (p_marks->>m.hash)::bigint else null end
   where m.uid = p_uid and p_marks ? m.hash;
$$;

create or replace function public.opengym_media_delete(p_uid text, p_hashes text[])
returns void language sql security definer set search_path = opengym, pg_temp as $$
  delete from media where uid = p_uid and hash = any (p_hashes);
$$;

create or replace function public.opengym_media_users()
returns jsonb language sql stable security definer set search_path = opengym, pg_temp as $$
  select coalesce(jsonb_agg(distinct uid), '[]'::jsonb) from media;
$$;

-- ---------------------------------------------------------------- who may call them

do $$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'opengym\_%' loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon', f); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on function %s from authenticated', f); end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', f); end if;
  end loop;
end $$;

-- The Storage bucket for photos and videos: private, nothing public about it.
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public) values ('opengym-media', 'opengym-media', false)
      on conflict (id) do nothing;
  end if;
end $$;

-- Tell PostgREST about the new functions.
notify pgrst, 'reload schema';
