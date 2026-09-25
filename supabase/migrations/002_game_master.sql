-- AI game master: per-room call counter, checked by the game-master Edge Function.
alter table public.dg_rooms add column gm_calls int not null default 0;

-- Verifies the host token and counts the call. Only the Edge Function (service role) may run it.
create or replace function public.dg_gm_tick(p_code text, p_host_token text)
returns int language plpgsql security definer set search_path = public as $$
declare v_calls int;
begin
  perform dg_check_host(p_code, p_host_token);
  update dg_rooms set gm_calls = gm_calls + 1 where code = upper(p_code) returning gm_calls into v_calls;
  return v_calls;
end $$;

revoke execute on function public.dg_gm_tick(text, text) from public, anon, authenticated;
grant execute on function public.dg_gm_tick(text, text) to service_role;
