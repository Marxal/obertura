-- One-off, 2026-11: bring the live database into line with SUPABASE-SYNC.md §1.
-- Safe to run more than once. Deletes no account, no game and no stats history.
--
-- Run it from the repo root:
--   supabase db query --linked --file scripts/sql/2026-11-database-fix.sql

begin;

-- 1. Stats history: only accounts used in the last 35 days.
create or replace function public.snapshot_profile_stats()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
  active_days constant integer := 35;
begin
  insert into public.stats_daily (day, id, stats)
  select current_date, p.id, p.stats
    from public.profiles p
   where p.stats is not null
     and p.stats->>'lastActiveDay'
         >= to_char(current_date - active_days, 'YYYY-MM-DD')
  on conflict (day, id) do update set stats = excluded.stats;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.snapshot_profile_stats() from public, anon, authenticated;

-- 2. Stats history: kept for 400 days, then removed.
create or replace function public.prune_profile_stats()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
  keep_days constant integer := 400;
begin
  delete from public.stats_daily where day < current_date - keep_days;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.prune_profile_stats() from public, anon, authenticated;

-- 3. Once a week instead of every night. Scheduling by the same name replaces the job.
select cron.schedule('snapshot-profile-stats', '17 3 * * 1', 'select public.snapshot_profile_stats()');
select cron.schedule('prune-profile-stats', '47 3 * * 0', 'select public.prune_profile_stats()');

-- 4. A free account can't store games, whatever a modified browser sends.
--    Quiet on purpose: refusing would fail the whole push, lines included.
--    Games a row already holds are left alone.
create or replace function public.profiles_free_games_guard()
returns trigger
language plpgsql
as $$
begin
  if new.entitled then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.games := null;
    new.games_updated_at := null;
  else
    new.games := old.games;
    new.games_updated_at := old.games_updated_at;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_free_games_guard on public.profiles;
create trigger profiles_free_games_guard
  before insert or update on public.profiles
  for each row execute function public.profiles_free_games_guard();

-- 5. Remove an old login session stored in a row by the bug described in
--    src/local-keys.ts. Nothing reads it, and a credential doesn't belong there.
update public.profiles
   set repertoire = repertoire #- '{local,obertura.supabase.auth}'
 where repertoire -> 'local' ? 'obertura.supabase.auth';

commit;
