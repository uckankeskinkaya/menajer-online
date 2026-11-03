-- MENAJER ONLINE 030: oynama süresi (execute_sql ile). Maçta oynayan gençlere ek gelişim puanı, forma bulamayan önemli oyuncuların morali düşer;
-- yoğun antrenman sakatlığı %12 -> %9.
-- hafta sonu antrenmanı (her takım kendi programıyla; YZ takımları genel/normal)
create or replace function public._train_week(p_game uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare g record; t record; pid int; pn text; w int; lst text; played int[];
begin
  select * into g from public.games where id = p_game;
  -- bu haftanın resmi maçlarında oynayanlar (maç puanı alanlar)
  played := array(select (k.key)::int from public.fixtures f, jsonb_object_keys(coalesce(f.stats->'rt', '{}'::jsonb)) k(key)
                    where f.game_id = p_game and f.round = g.current_round and f.played and f.comp <> 'friendly');
  -- dinlenme: hafif +26, normal +20, yoğun +14 (fizik odağı +4); moral: iki haftada bir hafif +1, yoğun -1
  update public.squads q set
    fitness = least(100, q.fitness + (array[26, 20, 14])[1 + coalesce((tm.training->>'int')::int, 1)] + case when tm.training->>'focus' = 'fizik' then 4 else 0 end),
    injury = greatest(0, q.injury - 1),
    morale = greatest(0, least(100, q.morale + case when random() < 0.5 then 0 when coalesce((tm.training->>'int')::int, 1) = 0 then 1 when coalesce((tm.training->>'int')::int, 1) = 2 then -1 else 0 end))
   from public.teams tm where tm.id = q.team_id and q.game_id = p_game;
  -- gelişim puanı: gençler daha hızlı, yoğunluk ve mevkiye uygun odak hızlandırır, potansiyelde durur
  update public.squads q set xp = q.xp + round(
      (case when p.age + g.season - 1 <= 20 then 4 when p.age + g.season - 1 <= 23 then 3 when p.age + g.season - 1 <= 26 then 1.5 else 0 end)
      * (array[0.6, 1.0, 1.4])[1 + coalesce((tm.training->>'int')::int, 1)]
      * case coalesce(tm.training->>'focus', 'genel')
          when 'genel' then 1.1
          when 'hucum' then case when p.grp = 'FWD' then 1.4 else 0.9 end
          when 'ortasaha' then case when p.grp = 'MID' then 1.4 else 0.9 end
          when 'savunma' then case when p.grp in ('DEF', 'GK') then 1.4 else 0.9 end
          else 0.9 end)::int
   from public.teams tm, public.real_players p
   where tm.id = q.team_id and p.id = q.player_id and q.game_id = p_game and q.injury = 0 and not tm.guest and p.ovr + q.ovr_delta < p.pot;
  -- maçta oynayan gençlere ek gelişim puanı (23 yaş ve altı +3, 26 ve altı +1)
  update public.squads q set xp = q.xp + case when p.age + g.season - 1 <= 23 then 3 else 1 end
   from public.real_players p, public.teams tm
   where p.id = q.player_id and tm.id = q.team_id and q.game_id = p_game and not tm.guest and q.player_id = any(played)
     and p.age + g.season - 1 <= 26 and p.ovr + q.ovr_delta < p.pot;
  -- forma şansı bulamayan önemli oyuncular (menajer takımlarında kadronun en iyi 14'ü, sağlam ve dinç) huzursuzlanır
  update public.squads q set morale = greatest(0, q.morale - 2)
   from public.teams tm
   where tm.id = q.team_id and q.game_id = p_game and not tm.is_bot and q.injury = 0 and q.ban = 0 and q.fitness >= 70
     and not (q.player_id = any(played))
     and exists (select 1 from public.fixtures f where f.game_id = p_game and f.round = g.current_round and f.played and f.comp <> 'friendly' and tm.id in (f.home, f.away))
     and q.player_id in (select q2.player_id from public.squads q2 join public.real_players p2 on p2.id = q2.player_id
                          where q2.team_id = tm.id order by p2.ovr + q2.ovr_delta desc limit 14);
  -- 100 puan = +1 güç, değer %6 artar
  for t in select tm.id, tm.is_bot from public.teams tm where tm.game_id = p_game
            and exists (select 1 from public.squads x where x.team_id = tm.id and x.xp >= 100) loop
    select string_agg(p.name || ' ' || (p.ovr + q.ovr_delta + 1), ', ') into lst
      from public.squads q join public.real_players p on p.id = q.player_id where q.team_id = t.id and q.xp >= 100;
    update public.squads set xp = xp - 100, ovr_delta = ovr_delta + 1, value = (round(value * 1.06 / 1000) * 1000)::bigint
     where team_id = t.id and xp >= 100;
    if not t.is_bot then perform public._news(p_game, t.id, 'info', '📈 Antrenmanda gelişenler: ' || lst); end if;
  end loop;
  -- antrenman sakatlığı: normalde %4, yoğunda %9 (fizik odağı yarıya indirir)
  for t in select tm.id, tm.is_bot, coalesce((tm.training->>'int')::int, 1) i, coalesce(tm.training->>'focus', 'genel') f
             from public.teams tm where tm.game_id = p_game and not tm.guest loop
    if random() < ((array[0.0, 0.04, 0.09])[1 + t.i] * (case when t.f = 'fizik' then 0.5 else 1 end)) then
      select q.player_id, p.name into pid, pn from public.squads q join public.real_players p on p.id = q.player_id
       where q.team_id = t.id and q.injury = 0 order by random() limit 1;
      if pid is not null then
        w := 1 + floor(random() * 2)::int;
        update public.squads set injury = w where game_id = p_game and player_id = pid;
        if not t.is_bot then perform public._news(p_game, t.id, 'info', '🚑 ' || pn || ' antrenmanda sakatlandı: ' || w || ' hafta yok'); end if;
      end if;
    end if;
  end loop;
end $$;
