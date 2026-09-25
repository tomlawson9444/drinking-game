-- New rounds: knockout matches submit one vote per match (kinds m0, m1, ...), Out of Context
-- adds a "twist" step, and Tee K.O. drawings need more room than a text answer.
alter table public.dg_submissions drop constraint if exists dg_submissions_kind_check;
alter table public.dg_submissions add constraint dg_submissions_kind_check
  check (kind in ('input', 'vote', 'twist') or kind similar to 'm[0-9]{1,3}');

create or replace function public.dg_submit(p_code text, p_token text, p_round int, p_kind text, p_value jsonb)
returns void language plpgsql security definer set search_path = public as $fn$
declare
  v_code text := upper(p_code);
  v_player uuid;
  v_max int;
begin
  select p.id into v_player from dg_players p join dg_player_secrets s on s.player_id = p.id
   where p.room_code = v_code and s.token = p_token;
  if v_player is null then raise exception 'Not in this room'; end if;
  if not exists (select 1 from dg_rooms where code = v_code and round = p_round) then
    raise exception 'That round is over';
  end if;
  -- Drawings (Tee K.O.) are small JPEG data URLs; everything else is short text.
  v_max := case when p_value->>'img' is not null then 60000 else 500 end;
  if length(p_value::text) > v_max then
    raise exception 'Answer too big';
  end if;

  insert into dg_submissions (room_code, round, player_id, kind, value)
  values (v_code, p_round, v_player, p_kind, p_value)
  on conflict do nothing;
end $fn$;
