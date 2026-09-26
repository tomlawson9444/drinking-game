-- Player selfies (small JPEG data URLs) and the Rule Maker's submission kind.
alter table public.dg_players add column if not exists photo text;
alter table public.dg_players add column if not exists photo_v int not null default 0;

alter table public.dg_submissions drop constraint if exists dg_submissions_kind_check;
alter table public.dg_submissions add constraint dg_submissions_kind_check
  check (kind in ('input', 'vote', 'twist', 'rule') or kind similar to 'm[0-9]{1,3}');

-- A player sets (or clears) their own photo. Only small JPEG data URLs are accepted.
create or replace function public.dg_set_photo(p_code text, p_token text, p_photo text)
returns void language plpgsql security definer set search_path = public as $fn$
declare
  v_player uuid;
begin
  select p.id into v_player from dg_players p join dg_player_secrets s on s.player_id = p.id
   where p.room_code = upper(p_code) and s.token = p_token;
  if v_player is null then raise exception 'Not in this room'; end if;
  if p_photo is not null and (length(p_photo) > 30000 or p_photo not like 'data:image/jpeg;base64,%') then
    raise exception 'Photo too big';
  end if;
  update dg_players set photo = p_photo, photo_v = photo_v + 1 where id = v_player;
end $fn$;

grant execute on function public.dg_set_photo(text, text, text) to anon, authenticated;
