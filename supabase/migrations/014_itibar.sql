-- MENAJER ONLINE 014: (1) 012'de kopyalama sırasında boşlukları bozulup atlanan hafta sonu maaş/sponsor değişikliği,
-- (2) kulüp itibarı lig içi sıraya göre (1. → 5, 2-3. → 4, 4. → 3, ilk yarı → 2, kalan → 1). 012'den sonra uygulanır.
do $$
declare d text;
begin
  d := pg_get_functiondef('public._after_round(uuid,int)'::regprocedure);
  if position('_fin(t.id, ''maas''' in d) > 0 then return; end if;  -- zaten uygulanmış
  if position($a$  for t in select tm.id, tm.is_bot, round(sum(q.value) * (s->>'wage_pct')::numeric)::bigint w
             from public.teams tm join public.squads q on q.team_id = tm.id where tm.game_id = p_game group by tm.id, tm.is_bot loop
    update public.teams set budget = budget - t.w where id = t.id;
    if not t.is_bot then perform public._news(p_game, t.id, 'info', 'Haftalık maaşlar ödendi: ' || public._money(t.w)); end if;
  end loop;$a$ in d) = 0 then raise exception '_after_round maaş bloğu bulunamadı'; end if;
  execute replace(d, $a$  for t in select tm.id, tm.is_bot, round(sum(q.value) * (s->>'wage_pct')::numeric)::bigint w
             from public.teams tm join public.squads q on q.team_id = tm.id where tm.game_id = p_game group by tm.id, tm.is_bot loop
    update public.teams set budget = budget - t.w where id = t.id;
    if not t.is_bot then perform public._news(p_game, t.id, 'info', 'Haftalık maaşlar ödendi: ' || public._money(t.w)); end if;
  end loop;$a$, $b$  for t in select tm.id, tm.is_bot, tm.weekly_income inc, coalesce(sum(q.wage), 0)::bigint w
             from public.teams tm left join public.squads q on q.team_id = tm.id where tm.game_id = p_game group by tm.id, tm.is_bot, tm.weekly_income loop
    update public.teams set budget = budget - t.w + t.inc where id = t.id;
    perform public._fin(t.id, 'maas', t.w); perform public._fin(t.id, 'sponsor', t.inc);
    if not t.is_bot then perform public._news(p_game, t.id, 'info', 'Haftalık maaşlar: ' || public._money(t.w)
      || case when t.inc > 0 then ' · sponsor ve yayın geliri: ' || public._money(t.inc) else '' end); end if;
  end loop;$b$);
end $$;

do $$
declare d text;
begin
  d := pg_get_functiondef('public._setup_finances(uuid,boolean)'::regprocedure);
  if position('when i <= 3 then 4' in d) > 0 then return; end if;  -- zaten uygulanmış
  if position('reputation = greatest(1, 5 - ((i - 1) * 5) / greatest(n, 1)),' in d) = 0 then raise exception '_setup_finances beklenen haliyle değil'; end if;
  execute replace(d, 'reputation = greatest(1, 5 - ((i - 1) * 5) / greatest(n, 1)),',
    'reputation = case when i = 1 then 5 when i <= 3 then 4 when i <= greatest(4, ceil(n * 0.22)) then 3 when i <= ceil(n / 2.0) then 2 else 1 end,');
end $$;
-- açık kariyerlerdeki kulüpler
update public.teams t set reputation = case when x.i = 1 then 5 when x.i <= 3 then 4 when x.i <= greatest(4, ceil(x.n * 0.22)) then 3 when x.i <= ceil(x.n / 2.0) then 2 else 1 end
  from (select tm.id, row_number() over (partition by tm.game_id order by coalesce(sum(q.value), 0) desc) i, count(*) over (partition by tm.game_id) n
          from public.teams tm join public.games g on g.id = tm.game_id left join public.squads q on q.team_id = tm.id
         where g.settings ? 'career' group by tm.id, tm.game_id) x
 where x.id = t.id;
