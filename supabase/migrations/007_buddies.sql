-- Drinking buddies: the round winner's pick is its own submission kind.
alter table public.dg_submissions drop constraint if exists dg_submissions_kind_check;
alter table public.dg_submissions add constraint dg_submissions_kind_check
  check (kind in ('input', 'vote', 'twist', 'rule', 'buddy') or kind similar to 'm[0-9]{1,3}');
