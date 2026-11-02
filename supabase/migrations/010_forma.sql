-- MENAJER ONLINE 010 (Faz 3): forma numaraları, forma deseni + arma, forma editörü RPC'si

alter table public.squads add column if not exists shirt int;
alter table public.teams add column if not exists kit jsonb not null default '{"pattern":"plain","crest":"shield","symbol":""}';

-- mevkiye göre tercih edilen numaralardan takımda boş olan ilki
create or replace function public._free_shirt(p_team uuid, p_player int, p_grp text) returns int
language plpgsql stable security definer set search_path = '' as $$
declare pref int[]; n int;
begin
  pref := case p_grp
    when 'GK'  then array[1,12,13,25,30,31,99]
    when 'DEF' then array[2,3,4,5,6,15,14,22,24,26,28,32,33]
    when 'MID' then array[8,6,10,7,14,16,17,18,20,21,23,19]
    else array[9,11,7,10,19,27,29,17,20,21,99] end;
  foreach n in array pref loop
    if not exists (select 1 from public.squads where team_id = p_team and shirt = n and player_id <> p_player) then return n; end if;
  end loop;
  for n in 1..99 loop
    if not exists (select 1 from public.squads where team_id = p_team and shirt = n and player_id <> p_player) then return n; end if;
  end loop;
  return null;
end $$;

create or replace function public._squads_shirt() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.shirt is null or tg_op = 'INSERT' or new.team_id is distinct from old.team_id then
    new.shirt := public._free_shirt(new.team_id, new.player_id, (select grp from public.real_players where id = new.player_id));
  end if;
  return new;
end $$;
drop trigger if exists squads_shirt on public.squads;
create trigger squads_shirt before insert or update of team_id on public.squads
  for each row execute function public._squads_shirt();

-- mevcut kadrolara numara ver (en iyiler önce: 1, 9, 10 gibi numaralar yıldızlara)
do $$
declare q record;
begin
  update public.squads set shirt = null;
  for q in select s.game_id, s.player_id, s.team_id, p.grp from public.squads s join public.real_players p on p.id = s.player_id
            order by s.team_id, p.ovr + s.ovr_delta desc loop
    update public.squads set shirt = public._free_shirt(q.team_id, q.player_id, q.grp) where game_id = q.game_id and player_id = q.player_id;
  end loop;
end $$;

-- forma ve arma: renkler, desen, arma şekli ve sembol
create or replace function public.set_kit(p_game uuid, p_c1 text, p_c2 text, p_pattern text, p_crest text, p_symbol text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := public._my_team(p_game);
begin
  if me is null then return jsonb_build_object('ok', false, 'msg', 'Bu odada takımın yok'); end if;
  if p_c1 !~ '^#[0-9a-fA-F]{6}$' or p_c2 !~ '^#[0-9a-fA-F]{6}$' then return jsonb_build_object('ok', false, 'msg', 'Geçersiz renk'); end if;
  if p_pattern not in ('plain','stripes','hoops','halves','sash') then return jsonb_build_object('ok', false, 'msg', 'Geçersiz desen'); end if;
  if p_crest not in ('shield','circle','diamond','classic') then return jsonb_build_object('ok', false, 'msg', 'Geçersiz arma'); end if;
  if coalesce(p_symbol, '') <> '' and p_symbol not in ('★','⚡','🦅','🦁','🐺','🔥','⚓','👑','⚔️','🌙','☀️','🐂','🐉','🌊','⛰️','🍀') then
    return jsonb_build_object('ok', false, 'msg', 'Geçersiz sembol'); end if;
  update public.teams set color1 = lower(p_c1), color2 = lower(p_c2),
    kit = jsonb_build_object('pattern', p_pattern, 'crest', p_crest, 'symbol', coalesce(p_symbol, ''))
   where id = me;
  return jsonb_build_object('ok', true, 'msg', 'Forma kaydedildi');
end $$;

revoke execute on function public._free_shirt(uuid, int, text) from public, anon, authenticated;
revoke execute on function public._squads_shirt() from public, anon, authenticated;
revoke execute on function public.set_kit(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.set_kit(uuid, text, text, text, text, text) to authenticated;
