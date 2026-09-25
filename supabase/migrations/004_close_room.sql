-- Lets the host shut a room down: deleting it removes its players, answers and votes
-- (cascade), which sends every phone in that room back to the start screen.
create or replace function public.dg_close_room(p_code text, p_host_token text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform dg_check_host(p_code, p_host_token);
  delete from dg_rooms where code = upper(p_code);
end $$;

grant execute on function public.dg_close_room(text, text) to anon, authenticated;
