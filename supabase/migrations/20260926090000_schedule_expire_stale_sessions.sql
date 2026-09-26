-- MirrorFit AI - schedule expire_stale_sessions via pg_cron
--
-- Thresholds (existing, not invented here)
-- ----------------------------------------
-- WAITING / PAIRED: expire when pairing_expires_at <= now()
--   Default pairing TTL at create is 120s (apps/web pairing.ts).
-- ACTIVE: expire when last_activity_at is older than p_idle_seconds
--   Function default is 900 seconds (15 minutes).
--
-- Scheduling
-- ----------
-- Database-side pg_cron only. No HTTP endpoint, no service-role key in the
-- job command — the schedule invokes the existing security-definer RPC as
-- SQL inside Postgres.

create extension if not exists pg_cron with schema pg_catalog;

-- Idempotent re-apply: drop any prior job with this name.
do $$
declare
  v_jobid bigint;
begin
  for v_jobid in
    select j.jobid from cron.job j where j.jobname = 'expire-stale-sessions'
  loop
    perform cron.unschedule(v_jobid);
  end loop;
end
$$;

-- Every minute is fine: the function is idempotent and only touches rows that
-- already passed their thresholds. Pairing claim still requires
-- pairing_expires_at > now(), so a late sweep cannot revive a timed-out QR.
select cron.schedule(
  'expire-stale-sessions',
  '* * * * *',
  $cron$select public.expire_stale_sessions(900)$cron$
);
