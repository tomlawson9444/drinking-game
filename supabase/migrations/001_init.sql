-- Last Orders: party drinking game schema.
-- No Supabase Auth accounts: players join with a room code + nickname and get a
-- random secret token (kept in their browser). Every write goes through the
-- SECURITY DEFINER functions below, which check that token. Anonymous clients
-- can only SELECT public game state; secrets tables are not readable at all.

create table public.dg_rooms (
  code        text primary key,
  phase       text not null default 'lobby',
  round       int  not null default 0,
  state       jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.dg_room_secrets (
  code        text primary key references public.dg_rooms(code) on delete cascade,
  host_token  text not null
);

create table public.dg_players (
  id          uuid primary key default gen_random_uuid(),
  room_code   text not null references public.dg_rooms(code) on delete cascade,
  name        text not null check (char_length(name) between 1 and 16),
  color       text not null,
  score       int  not null default 0,
  sips        int  not null default 0,
  joined_at   timestamptz not null default now(),
  unique (room_code, name)
);
create index dg_players_room_idx on public.dg_players(room_code);

create table public.dg_player_secrets (
  player_id   uuid primary key references public.dg_players(id) on delete cascade,
  token       text not null unique
);

create table public.dg_submissions (
  room_code   text not null references public.dg_rooms(code) on delete cascade,
  round       int  not null,
  player_id   uuid not null references public.dg_players(id) on delete cascade,
  kind        text not null check (kind in ('input', 'vote')),
  value       jsonb not null,
  created_at  timestamptz not null default now(),
  primary key (room_code, round, player_id, kind)
);

-- Row level security: public read of game state, no direct writes.
alter table public.dg_rooms          enable row level security;
alter table public.dg_room_secrets   enable row level security;
alter table public.dg_players        enable row level security;
alter table public.dg_player_secrets enable row level security;
alter table public.dg_submissions    enable row level security;

create policy "read rooms"       on public.dg_rooms       for select to anon, authenticated using (true);
create policy "read players"     on public.dg_players     for select to anon, authenticated using (true);
create policy "read submissions" on public.dg_submissions for select to anon, authenticated using (true);

revoke all on public.dg_room_secrets, public.dg_player_secrets from anon, authenticated;
revoke insert, update, delete on public.dg_rooms, public.dg_players, public.dg_submissions from anon, authenticated;

-- Realtime (full replica identity so filtered DELETE events are delivered).
alter table public.dg_players     replica identity full;
alter table public.dg_submissions replica identity full;
alter publication supabase_realtime add table public.dg_rooms, public.dg_players, public.dg_submissions;

-- ---------------------------------------------------------------- helpers

create or replace function public.dg_check_host(p_code text, p_host_token text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from dg_room_secrets where code = upper(p_code) and host_token = p_host_token) then
    raise exception 'Not the host of this room';
  end if;
end $$;

-- ---------------------------------------------------------------- RPCs

create or replace function public.dg_create_room(p_host_token text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_code text;
  v_letters constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ';
begin
  if coalesce(length(p_host_token), 0) < 16 then raise exception 'Bad token'; end if;

  -- Housekeeping: rooms are throwaway, drop anything idle for 12 hours.
  delete from dg_rooms where updated_at < now() - interval '12 hours';

  loop
    v_code := '';
    for i in 1..4 loop
      v_code := v_code || substr(v_letters, 1 + floor(random() * length(v_letters))::int, 1);
    end loop;
    exit when not exists (select 1 from dg_rooms where code = v_code);
  end loop;

  insert into dg_rooms (code) values (v_code);
  insert into dg_room_secrets (code, host_token) values (v_code, p_host_token);
  return v_code;
end $$;

create or replace function public.dg_join_room(p_code text, p_name text, p_token text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_code  text := upper(trim(p_code));
  v_name  text := trim(p_name);
  v_id    uuid;
  v_count int;
  v_colors constant text[] := array['#ff4f79','#ffb400','#3ddc97','#4cc9f0','#b388ff','#ff8a3d',
                                    '#f15bb5','#00bbf9','#9ef01a','#fee440','#ff595e','#8ac926'];
begin
  if coalesce(length(p_token), 0) < 16 then raise exception 'Bad token'; end if;
  if not exists (select 1 from dg_rooms where code = v_code) then
    raise exception 'Room % not found', v_code;
  end if;

  -- Rejoin with the same device token.
  select p.id into v_id from dg_players p join dg_player_secrets s on s.player_id = p.id
   where p.room_code = v_code and s.token = p_token;
  if v_id is not null then return v_id; end if;

  if v_name = '' or char_length(v_name) > 16 then raise exception 'Name must be 1-16 characters'; end if;
  if exists (select 1 from dg_players where room_code = v_code and lower(name) = lower(v_name)) then
    raise exception 'Someone is already called %', v_name;
  end if;

  select count(*) into v_count from dg_players where room_code = v_code;
  if v_count >= 12 then raise exception 'Room is full (12 players max)'; end if;

  insert into dg_players (room_code, name, color)
  values (v_code, v_name, v_colors[1 + (v_count % array_length(v_colors, 1))])
  returning id into v_id;
  insert into dg_player_secrets (player_id, token) values (v_id, p_token);
  update dg_rooms set updated_at = now() where code = v_code;
  return v_id;
end $$;

create or replace function public.dg_submit(p_code text, p_token text, p_round int, p_kind text, p_value jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_code text := upper(p_code);
  v_player uuid;
begin
  select p.id into v_player from dg_players p join dg_player_secrets s on s.player_id = p.id
   where p.room_code = v_code and s.token = p_token;
  if v_player is null then raise exception 'Not in this room'; end if;
  if not exists (select 1 from dg_rooms where code = v_code and round = p_round) then
    raise exception 'That round is over';
  end if;
  if length(p_value::text) > 500 then raise exception 'Answer too long'; end if;

  insert into dg_submissions (room_code, round, player_id, kind, value)
  values (v_code, p_round, v_player, p_kind, p_value)
  on conflict do nothing;
end $$;

create or replace function public.dg_host_set_state(p_code text, p_host_token text, p_phase text, p_round int, p_state jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform dg_check_host(p_code, p_host_token);
  update dg_rooms set phase = p_phase, round = p_round, state = p_state, updated_at = now()
   where code = upper(p_code);
end $$;

-- p_deltas: [{"id": "<player uuid>", "score": 100, "sips": 2}, ...]
create or replace function public.dg_host_apply(p_code text, p_host_token text, p_deltas jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform dg_check_host(p_code, p_host_token);
  update dg_players p
     set score = p.score + coalesce((d->>'score')::int, 0),
         sips  = p.sips  + coalesce((d->>'sips')::int, 0)
    from jsonb_array_elements(p_deltas) d
   where p.room_code = upper(p_code) and p.id = (d->>'id')::uuid;
end $$;

create or replace function public.dg_host_reset(p_code text, p_host_token text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform dg_check_host(p_code, p_host_token);
  update dg_players set score = 0, sips = 0 where room_code = upper(p_code);
  delete from dg_submissions where room_code = upper(p_code);
  update dg_rooms set phase = 'lobby', round = 0, state = '{}'::jsonb, updated_at = now()
   where code = upper(p_code);
end $$;

create or replace function public.dg_host_kick(p_code text, p_host_token text, p_player uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform dg_check_host(p_code, p_host_token);
  delete from dg_players where room_code = upper(p_code) and id = p_player;
end $$;

revoke execute on function public.dg_check_host(text, text) from public, anon, authenticated;
grant execute on function
  public.dg_create_room(text),
  public.dg_join_room(text, text, text),
  public.dg_submit(text, text, int, text, jsonb),
  public.dg_host_set_state(text, text, text, int, jsonb),
  public.dg_host_apply(text, text, jsonb),
  public.dg_host_reset(text, text),
  public.dg_host_kick(text, text, uuid)
to anon, authenticated;
