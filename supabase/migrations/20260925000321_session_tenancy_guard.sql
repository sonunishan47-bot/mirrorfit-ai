-- MirrorFit AI - tenancy guard on session termination
--
-- Corrects an inconsistency in the previous migration.
--
-- `activate_display_session` takes the caller's display id and refuses to act
-- on a session belonging to a different mirror. `end_display_session` took
-- only a session id, so any authenticated mirror could have terminated any
-- session in any organization by guessing or observing a uuid.
--
-- That is the exact failure the architecture rules describe: an operation
-- that trusts an identifier from the caller instead of resolving authority
-- from the principal. A session id is not a capability.
--
-- The function is replaced rather than patched around in the route, because a
-- check that lives only in one call site is a check the second call site
-- forgets.

drop function public.end_display_session(uuid, public.session_end_reason);

create function public.end_display_session(
  p_session_id uuid,
  p_display_id uuid,
  p_reason public.session_end_reason
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sessions%rowtype;
begin
  update public.sessions s
  set status = 'ENDED',
      ended_at = now(),
      end_reason = p_reason,
      last_activity_at = now()
  where s.id = p_session_id
    and s.display_id = p_display_id
    and s.status in ('WAITING', 'PAIRED', 'ACTIVE')
  returning * into v_session;

  if v_session.id is null then
    -- Scoped to this display, so a caller cannot use the difference between
    -- "not found" and "already ended" to probe for another mirror's sessions.
    select * into v_session
    from public.sessions s
    where s.id = p_session_id
      and s.display_id = p_display_id;

    if v_session.id is null then
      raise exception 'session not found' using errcode = 'P0002';
    end if;

    -- Already terminal. Report the original outcome instead of failing, so a
    -- mirror retrying after a dropped response does not error, and so the
    -- first answer about why a session ended stays the true one.
    return jsonb_build_object(
      'session_id', v_session.id,
      'status', v_session.status,
      'end_reason', v_session.end_reason,
      'already_ended', true
    );
  end if;

  return jsonb_build_object(
    'session_id', v_session.id,
    'status', v_session.status,
    'end_reason', v_session.end_reason,
    'already_ended', false
  );
end;
$$;

revoke execute on function
  public.end_display_session(uuid, uuid, public.session_end_reason)
from public, anon, authenticated;

grant execute on function
  public.end_display_session(uuid, uuid, public.session_end_reason)
to service_role;
