-- MENAJER ONLINE 032: kiralık kolonları, iki kısa fonksiyon, tetikleyici ve yetkiler. SQL Editor'den çalıştır.
alter table public.squads add column if not exists loan_from text;
alter table public.squads add column if not exists loan_team uuid;

-- kiralık oyuncu satılamaz/transfer edilemez (tetikleyici: 032)
create or replace function public._loan_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.loan_from is null or coalesce(current_setting('app.loan', true), '') = '1' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    -- oda/takım silinirken (cascade) izin ver
    if not exists (select 1 from public.teams where id = old.team_id) or not exists (select 1 from public.games where id = old.game_id) then return old; end if;
    raise exception 'Kiralık oyuncu satılamaz: sezon sonunda kulübüne döner';
  end if;
  if new.team_id is distinct from old.team_id then
    raise exception 'Kiralık oyuncu transfer edilemez: sezon sonunda kulübüne döner';
  end if;
  return new;
end $$;

-- sezon sonu: kiralık oyuncular kulüplerine döner
create or replace function public._end_loans(p_game uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare t record; lst text;
begin
  perform set_config('app.loan', '1', true);
  for t in select tm.id, tm.is_bot from public.teams tm where tm.game_id = p_game
            and exists (select 1 from public.squads x where x.team_id = tm.id and x.loan_from is not null) loop
    select string_agg(p.name || ' (' || q.loan_from || ')', ', ') into lst
      from public.squads q join public.real_players p on p.id = q.player_id where q.team_id = t.id and q.loan_from is not null;
    update public.squads q set team_id = q.loan_team, loan_from = null, loan_team = null
     where q.team_id = t.id and q.loan_from is not null and q.loan_team is not null and exists (select 1 from public.teams where id = q.loan_team);
    delete from public.squads where team_id = t.id and loan_from is not null;
    update public.teams set lineup = array(select x from unnest(lineup) x where exists (select 1 from public.squads where team_id = t.id and player_id = x)) where id = t.id;
    if not t.is_bot then perform public._news(p_game, t.id, 'info', '↩️ Kiralık oyuncular kulüplerine döndü: ' || lst); end if;
  end loop;
  perform set_config('app.loan', '', true);
end $$;

drop trigger if exists squads_loan_guard on public.squads;
create trigger squads_loan_guard before update of team_id or delete on public.squads for each row execute function public._loan_guard();
revoke execute on function public._loan_guard() from public, anon, authenticated;
revoke execute on function public._end_loans(uuid) from public, anon, authenticated;
revoke execute on function public.loan_player(uuid, int) from public, anon;
grant execute on function public.loan_player(uuid, int) to authenticated;
