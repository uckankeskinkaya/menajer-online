-- MENAJER ONLINE 022: yeni sezonda sözleşmesi bitenler bedelsiz ayrılır, YZ kulüpleri yeniler, menajer takımlarına altyapıdan 2 genç, moral 70'e yaklaşır. SQL Editor'den çalıştır (içinde delete var).
CREATE OR REPLACE FUNCTION public.new_season(p_game uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare g record; s jsonb; q record; age int; ch int; t record; pid int; lgs text[]; ret int := 0; lst text := ''; lst2 text; nl int := 0; freed int[] := '{}';
begin
  select * into g from public.games where id = p_game for update;
  if g.owner is distinct from auth.uid() then return jsonb_build_object('ok', false, 'msg', 'Sadece oda sahibi yeni sezonu başlatabilir'); end if;
  if g.status <> 'finished' then return jsonb_build_object('ok', false, 'msg', 'Sezon henüz bitmedi'); end if;
  s := public._settings(p_game);
  select array_agg(x) into lgs from jsonb_array_elements_text(s->'leagues') x;
  update public.games set season = season + 1, status = 'active', current_round = 0 where id = p_game;
  delete from public.fixtures where game_id = p_game;
  update public.offers set status = 'cancelled', note = 'Sezon bitti' where game_id = p_game and status = 'active';
  -- yaşlanma + gelişim (yeni sezondaki yaşa göre)
  for q in select sq.player_id, sq.team_id, sq.ovr_delta, sq.value, p.ovr, p.pot, p.age, p.name
             from public.squads sq join public.real_players p on p.id = sq.player_id where sq.game_id = p_game loop
    age := q.age + g.season;   -- g.season eski sezon; yeni sezonda yaş +1
    ch := case when age <= 21 then 1 + floor(random() * 4)::int
               when age <= 25 then floor(random() * 3)::int
               when age <= 29 then floor(random() * 3)::int - 1
               when age <= 32 then -floor(random() * 3)::int
               else -1 - floor(random() * 4)::int end;
    if ch > 0 then ch := least(ch, greatest(0, q.pot - (q.ovr + q.ovr_delta))); end if;
    if q.ovr + q.ovr_delta + ch < 40 then ch := 40 - q.ovr - q.ovr_delta; end if;
    -- emeklilik
    if age >= 38 or (age >= 35 and random() < (age - 33) * 0.2) then
      delete from public.squads where game_id = p_game and player_id = q.player_id;
      ret := ret + 1; lst := lst || case when lst = '' then '' else ', ' end || q.name;
      -- yerine altyapıdan genç oyuncu
      select p.id into pid from public.real_players p where p.lg = any(lgs) and p.age <= 20 and p.ovr between 60 and 70
         and not exists (select 1 from public.squads x where x.game_id = p_game and x.player_id = p.id) order by random() limit 1;
      if pid is not null then
        insert into public.squads (game_id, player_id, team_id, value) select p_game, p.id, q.team_id, p.val from public.real_players p where p.id = pid;
      end if;
      continue;
    end if;
    update public.squads set ovr_delta = ovr_delta + ch,
      value = greatest(100000, round(value * (1 + 0.08 * ch) * case when age >= 33 then 0.85 else 1 end))::bigint
     where game_id = p_game and player_id = q.player_id;
  end loop;
  -- sözleşmeler: menajer takımlarında süresi biten oyuncu bedelsiz ayrılır (kadro alt sınırı korunur); YZ kulüpleri yeniler
  for q in select sq.player_id, sq.team_id, p.name from public.squads sq join public.teams tm on tm.id = sq.team_id
             join public.real_players p on p.id = sq.player_id where sq.game_id = p_game and sq.contract <= 0 and not tm.is_bot loop
    if (select count(*) from public.squads where team_id = q.team_id) > coalesce((s->>'min_squad')::int, 16) then
      delete from public.squads where game_id = p_game and player_id = q.player_id;
      nl := nl + 1; freed := freed || q.player_id;
      perform public._news(p_game, q.team_id, 'info', '👋 ' || q.name || ' sözleşmesi bittiği için bedelsiz ayrıldı.');
    else
      update public.squads set contract = 1 where game_id = p_game and player_id = q.player_id;
      perform public._news(p_game, q.team_id, 'info', '✍️ Kadro alt sınırı nedeniyle ' || q.name || ' 1 yıl daha kaldı.');
    end if;
  end loop;
  update public.squads sq set contract = case when tm.is_bot then greatest(sq.contract - 1, 1) else greatest(sq.contract - 1, 0) end
    from public.teams tm where tm.id = sq.team_id and sq.game_id = p_game;
  -- altyapı: her menajer takımına yüksek potansiyelli 2 genç
  for t in select id from public.teams where game_id = p_game and not is_bot loop
    lst2 := '';
    for pid in select p.id from public.real_players p where p.age + g.season <= 20 and p.ovr between 55 and 68 and p.pot >= p.ovr + 8
                  and not exists (select 1 from public.squads x where x.game_id = p_game and x.player_id = p.id) and not (p.id = any(freed))
                order by (p.lg = any(lgs)) desc, random() limit 2 loop  -- önce kendi liginden
      exit when (select count(*) from public.squads where team_id = t.id) >= coalesce((s->>'max_squad')::int, 30);
      insert into public.squads (game_id, player_id, team_id, value, wage, contract, morale)
        select p_game, p.id, t.id, p.val, public._wage_of(p.val), 3, 75 from public.real_players p where p.id = pid;
      select lst2 || case when lst2 = '' then '' else ', ' end || p.name || ' (' || (p.age + g.season) || ' yaş, ' || p.ovr || ' → potansiyel ' || p.pot || ')'
        into lst2 from public.real_players p where p.id = pid;
    end loop;
    if lst2 <> '' then perform public._news(p_game, t.id, 'info', '🌱 Altyapıdan A takıma yükseldi: ' || lst2); end if;
  end loop;
  update public.squads set fitness = 100, injury = 0, ban = 0, yellows = 0, form = 6.5, morale = round(morale * 0.5 + 35) where game_id = p_game;
  update public.teams set fin = '{}', wage_budget = case when wage_budget > 0 then (round(wage_budget * 1.05 / 1000) * 1000)::bigint else 0 end where game_id = p_game;
  update public.teams set ready_round = 0, lineup = public._fix_lineup(id) where game_id = p_game;
  perform public._set_first_day(p_game);
  perform public._new_fixtures(p_game);
  perform public._news(p_game, null, 'start', (g.season + 1) || '. sezon başladı! Oyuncular bir yaş büyüdü.'
    || case when ret > 0 then ' Emekli olanlar: ' || lst || ' (yerlerine altyapıdan genç oyuncu geldi).' else '' end
    || coalesce(' İlk maç: ' || to_char((select min(kickoff_at) from public.fixtures where game_id = p_game) at time zone (s->>'tz'), 'DD.MM HH24:MI'), ''));
  return jsonb_build_object('ok', true, 'msg', (g.season + 1) || '. sezon başladı', 'retired', ret);
end $function$;
