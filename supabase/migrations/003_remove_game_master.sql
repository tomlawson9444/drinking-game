-- The AI game master was removed; drop its call counter.
drop function if exists public.dg_gm_tick(text, text);
alter table public.dg_rooms drop column if exists gm_calls;
