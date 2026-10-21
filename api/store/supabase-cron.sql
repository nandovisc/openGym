-- The timers of the single-process server, for STORE=supabase: pg_cron calls POST /api/cron/tick
-- through pg_net. Vercel's own cron runs once a day on the Hobby plan, too seldom for a rest timer.
--
-- Run after supabase.sql, with the app's address and the CRON_SECRET set on Vercel:
--   docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     -v app_url=https://your-app.vercel.app -v cron_secret=... < api/store/supabase-cron.sql
-- Running it again replaces the three jobs (same names), e.g. after changing the domain or secret.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select set_config('opengym.app_url', :'app_url', false);
select set_config('opengym.cron_secret', :'cron_secret', false);

do $$
declare
  base text := rtrim(current_setting('opengym.app_url'), '/') || '/api/cron/tick?job=';
  auth text := 'Bearer ' || current_setting('opengym.cron_secret');
  cmd text := 'select net.http_post(url := %L, headers := jsonb_build_object(''Authorization'', %L, ''Content-Type'', ''application/json''), body := ''{}''::jsonb, timeout_milliseconds := 55000)';
begin
  perform cron.unschedule(jobname) from cron.job where jobname in ('opengym-rest', 'opengym-minute', 'opengym-hourly');
  -- Rest-timer alerts: every 15 s, so one arrives at most ~15 s late.
  perform cron.schedule('opengym-rest', '15 seconds', format(cmd, base || 'rest', auth));
  -- The day's reminders and missed-workout nudges.
  perform cron.schedule('opengym-minute', '* * * * *', format(cmd, base || 'minute', auth));
  -- Audit-log retention and the media sweep.
  perform cron.schedule('opengym-hourly', '7 * * * *', format(cmd, base || 'hourly', auth));
end $$;

select jobname, schedule, active from cron.job where jobname like 'opengym-%' order by jobname;
