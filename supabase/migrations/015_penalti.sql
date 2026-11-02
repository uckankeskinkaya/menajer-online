-- MENAJER ONLINE 015: maç içinde penaltı (ceza sahasında faul/el; faulü yapana bazen kart) ve direkt serbest vuruş şutları.
-- Olaylar: goal/save/miss + {"pen": true, "f": faul yapan} ya da {"fk": true}. Gol sabiti 0.29 → 0.275 (penaltılarla ~2.5 gol/maç).
CREATE OR REPLACE FUNCTION public._sim_fixture(p_fix bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare fx record; H jsonb; A jsonb; P jsonb; minute int; ph numeric; side text; atk jsonb; dfn jsonb; ratio numeric;
  shp numeric; sh jsonb; gp numeric; vh int := 0; va int := 0; ev jsonb := '[]'; ast jsonb;
  posh int := 0; sh_h int := 0; sh_a int := 0; on_h int := 0; on_a int := 0; maxm int; friendly boolean;
  slH text[]; slA text[]; sl text[]; luH int[]; luA int[]; lu int[]; usedH int[]; usedA int[]; used int[];
  subsH int := 0; subsA int := 0; subs int; missH int := 0; missA int := 0; miss int;
  subMinH int; subMinA int; injMinH int; injMinA int; smin int; imin int;
  reds int[] := '{}'; yel int[] := '{}'; injured int[] := '{}'; direct_red int[] := '{}';
  pin jsonb := '{}'; effm jsonb := '{}'; k int; sd text; tid uuid; pid int; nin int; i int; chg boolean;
  mH numeric; mA numeric; aH jsonb; aA jsonb;
  rt jsonb := '{}'; r numeric; motm int; best numeric := -1; info jsonb; kv record; mins int; gf int; ga int;
  ng int; na int; svs int; s jsonb; pl text;
  fl int; tk jsonb; fk boolean; pq numeric; pe jsonb;
begin
  select * into fx from public.fixtures where id = p_fix;
  friendly := fx.comp = 'friendly';
  H := public._team_power(fx.home); A := public._team_power(fx.away);
  slH := public._slots(H->>'formation'); slA := public._slots(A->>'formation');
  select array_agg(x::int) into luH from jsonb_array_elements_text(H->'lineup') x;
  select array_agg(x::int) into luA from jsonb_array_elements_text(A->'lineup') x;
  usedH := luH; usedA := luA; aH := to_jsonb(luH); aA := to_jsonb(luA);
  for info in select x from jsonb_array_elements(H->'players') x loop
    pin := pin || jsonb_build_object(info->>'id', jsonb_build_object('s','h','in',0,'out',90,'g',info->>'g'));
    effm := effm || jsonb_build_object(info->>'id', info->'e');
  end loop;
  for info in select x from jsonb_array_elements(A->'players') x loop
    pin := pin || jsonb_build_object(info->>'id', jsonb_build_object('s','a','in',0,'out',90,'g',info->>'g'));
    effm := effm || jsonb_build_object(info->>'id', info->'e');
  end loop;
  subMinH := 58 + floor(random() * 18)::int; subMinA := 58 + floor(random() * 18)::int;
  injMinH := case when not friendly and random() < 0.08 then 1 + floor(random() * 88)::int end;
  injMinA := case when not friendly and random() < 0.08 then 1 + floor(random() * 88)::int end;
  maxm := 90 + floor(random() * 5)::int;

  for minute in 1..maxm loop
    -- sakatlık ve oyuncu değişiklikleri
    for k in 1..2 loop
      if k = 1 then sd := 'h'; tid := fx.home; lu := luH; used := usedH; subs := subsH; miss := missH; smin := subMinH; imin := injMinH; sl := slH; P := H;
      else sd := 'a'; tid := fx.away; lu := luA; used := usedA; subs := subsA; miss := missA; smin := subMinA; imin := injMinA; sl := slA; P := A; end if;
      chg := false;
      if minute = imin then
        select x into pid from unnest(lu) x where x <> (P->>'gkid')::int and not (x = any(reds)) and not (x = any(injured)) order by random() limit 1;
        if pid is not null then
          injured := injured || pid;
          ev := ev || jsonb_build_array(jsonb_build_object('m', minute, 't', 'injury', 's', sd, 'p', pid));
          i := array_position(lu, pid);
          nin := case when subs < 3 then public._bench_pick(tid, sl[i], used) end;
          if nin is not null then
            lu[i] := nin; used := used || nin; subs := subs + 1; chg := true;
            pin := jsonb_set(pin, array[pid::text, 'out'], to_jsonb(minute));
            pin := pin || jsonb_build_object(nin::text, jsonb_build_object('s', sd, 'in', minute, 'out', 90, 'g', sl[i]));
            ev := ev || jsonb_build_array(jsonb_build_object('m', minute, 't', 'sub', 's', sd, 'p', pid, 'a', nin));
          else miss := miss + 1; end if;
        end if;
      end if;
      if minute = smin and subs < 3 then
        for pid in select (x->>'id')::int from jsonb_array_elements(P->'players') x
                    where x->>'g' <> 'GK' and (x->>'id')::int = any(lu) and not ((x->>'id')::int = any(reds))
                    order by (x->>'fit')::int, random() limit least(3 - subs, 2 + (random() < 0.5)::int) loop
          i := array_position(lu, pid);
          nin := public._bench_pick(tid, sl[i], used);
          exit when nin is null;
          lu[i] := nin; used := used || nin; subs := subs + 1; chg := true;
          pin := jsonb_set(pin, array[pid::text, 'out'], to_jsonb(minute));
          pin := pin || jsonb_build_object(nin::text, jsonb_build_object('s', sd, 'in', minute, 'out', 90, 'g', sl[i]));
          ev := ev || jsonb_build_array(jsonb_build_object('m', minute, 't', 'sub', 's', sd, 'p', pid, 'a', nin));
        end loop;
      end if;
      if chg then
        P := public._power(tid, lu);
        for info in select x from jsonb_array_elements(P->'players') x loop effm := effm || jsonb_build_object(info->>'id', info->'e'); end loop;
      end if;
      -- kırmızı kart görenler ve yerine giremeyen sakatlar şut atamaz
      if chg or minute = 1 or cardinality(reds) + cardinality(injured) > 0 then
        P := jsonb_set(P, '{shooters}', coalesce((select jsonb_agg(x) from jsonb_array_elements(P->'shooters') x
               where (x->>'id')::int = any(lu) and not ((x->>'id')::int = any(reds)) and not ((x->>'id')::int = any(injured))), '[]'));
      end if;
      if k = 1 then luH := lu; usedH := used; subsH := subs; missH := miss; H := P; else luA := lu; usedA := used; subsA := subs; missA := miss; A := P; end if;
    end loop;

    -- eksik oyuncu (kırmızı / değiştirilemeyen sakat) başına %10 güç kaybı
    mH := power(0.9, missH); mA := power(0.9, missA);
    ph := ((H->>'mid')::numeric * mH) ^ 2 / (((H->>'mid')::numeric * mH) ^ 2 + ((A->>'mid')::numeric * mA) ^ 2) + 0.03;
    if random() < ph then side := 'h'; atk := H; dfn := A; posh := posh + 1;
      ratio := ((H->>'att')::numeric * 0.6 + (H->>'mid')::numeric * 0.4) * mH / ((A->>'def')::numeric * mA);
    else side := 'a'; atk := A; dfn := H;
      ratio := ((A->>'att')::numeric * 0.6 + (A->>'mid')::numeric * 0.4) * mA / ((H->>'def')::numeric * mH);
    end if;
    shp := 0.22 * ratio ^ 5;
    -- ceza sahasında faul ya da el: penaltı (hücum baskısı arttıkça daha sık)
    if random() < 0.0034 * least(greatest(ratio, 0.6), 1.5) ^ 2 and jsonb_array_length(atk->'shooters') > 0 then
      sd := case side when 'h' then 'a' else 'h' end;
      select (x->>'id')::int into fl from jsonb_array_elements(dfn->'players') x
       where x->>'g' in ('DEF', 'MID') and (x->>'id')::int = any(case side when 'h' then luA else luH end)
         and not ((x->>'id')::int = any(reds)) and not ((x->>'id')::int = any(injured))
       order by (x->>'g' = 'DEF') desc, random() limit 1;
      select x into tk from jsonb_array_elements(atk->'shooters') x order by (x->>'q')::numeric desc, random() limit 1;
      -- faulü yapana kart: çoğu sarı, bazen kırmızı (son adam / el)
      if fl is not null and random() < 0.3 then
        if fl = any(yel) or random() < 0.12 then
          if not (fl = any(yel)) then direct_red := direct_red || fl; end if;
          reds := reds || fl;
          ev := ev || jsonb_build_array(jsonb_build_object('m', least(minute, 90), 't', 'red', 's', sd, 'p', fl));
          if sd = 'h' then missH := missH + 1; else missA := missA + 1; end if;
        else
          yel := yel || fl;
          ev := ev || jsonb_build_array(jsonb_build_object('m', least(minute, 90), 't', 'yellow', 's', sd, 'p', fl));
        end if;
      end if;
      if side = 'h' then sh_h := sh_h + 1; else sh_a := sh_a + 1; end if;
      pq := least(0.9, greatest(0.62, 0.77 * ((tk->>'q')::numeric / greatest((dfn->>'gk')::numeric, 20)) ^ 0.4));
      pe := jsonb_build_object('m', least(minute, 90), 's', side, 'p', (tk->>'id')::int, 'pen', true, 'f', fl);
      if random() < pq then
        if side = 'h' then on_h := on_h + 1; vh := vh + 1; else on_a := on_a + 1; va := va + 1; end if;
        ev := ev || jsonb_build_array(pe || jsonb_build_object('t', 'goal'));
      elsif random() < 0.65 then
        if side = 'h' then on_h := on_h + 1; else on_a := on_a + 1; end if;
        ev := ev || jsonb_build_array(pe || jsonb_build_object('t', 'save', 'k', (dfn->>'gkid')::int));
      else
        ev := ev || jsonb_build_array(pe || jsonb_build_object('t', 'miss'));
      end if;
    elsif random() < shp and jsonb_array_length(atk->'shooters') > 0 then
      sh := public._pick_shooter(atk->'shooters');
      fk := random() < 0.05; -- direkt serbest vuruş
      if side = 'h' then sh_h := sh_h + 1; else sh_a := sh_a + 1; end if;
      if random() < 0.45 then
        if side = 'h' then on_h := on_h + 1; else on_a := on_a + 1; end if;
        gp := 0.275 * ((sh->>'q')::numeric / greatest((dfn->>'gk')::numeric, 20)) ^ 3;
        if random() < gp then
          ast := case when random() < 0.7 then public._pick_shooter(atk->'shooters') else null end;
          if ast is not null and ast->>'id' = sh->>'id' then ast := null; end if;
          ev := ev || jsonb_build_array(jsonb_build_object('m', least(minute, 90), 't','goal','s',side,'p',(sh->>'id')::int,'a',case when fk then null else (ast->>'id')::int end) || case when fk then '{"fk": true}'::jsonb else '{}'::jsonb end);
          if side = 'h' then vh := vh + 1; else va := va + 1; end if;
        else
          ev := ev || jsonb_build_array(jsonb_build_object('m', least(minute, 90), 't','save','s',side,'p',(sh->>'id')::int,'k',(dfn->>'gkid')::int) || case when fk then '{"fk": true}'::jsonb else '{}'::jsonb end);
        end if;
      else
        ev := ev || jsonb_build_array(jsonb_build_object('m', least(minute, 90), 't','miss','s',side,'p',(sh->>'id')::int) || case when fk then '{"fk": true}'::jsonb else '{}'::jsonb end);
      end if;
    elsif random() < 0.0125 and jsonb_array_length(dfn->'shooters') > 0 then
      -- savunan takımdan kart
      sh := public._pick_shooter(dfn->'shooters');
      pid := (sh->>'id')::int;
      sd := case side when 'h' then 'a' else 'h' end;
      if pid = any(yel) or random() < 0.05 then
        if not (pid = any(yel)) then direct_red := direct_red || pid; end if;
        reds := reds || pid;
        ev := ev || jsonb_build_array(jsonb_build_object('m', least(minute, 90), 't', 'red', 's', sd, 'p', pid));
        if sd = 'h' then missH := missH + 1; else missA := missA + 1; end if;
      else
        yel := yel || pid;
        ev := ev || jsonb_build_array(jsonb_build_object('m', least(minute, 90), 't', 'yellow', 's', sd, 'p', pid));
      end if;
    end if;
  end loop;

  -- oyuncu puanları
  for kv in select key, value from jsonb_each(pin) loop
    pid := kv.key::int; info := kv.value;
    mins := least(90, (info->>'out')::int) - (info->>'in')::int;
    if mins <= 0 then continue; end if;
    if info->>'s' = 'h' then gf := vh; ga := va; else gf := va; ga := vh; end if;
    select count(*) filter (where e->>'t' = 'goal' and (e->>'p')::int = pid),
           count(*) filter (where e->>'t' = 'goal' and (e->>'a')::int = pid),
           count(*) filter (where e->>'t' = 'save' and (e->>'k')::int = pid)
      into ng, na, svs from jsonb_array_elements(ev) e;
    r := 6.0 + case when gf > ga then 0.4 when gf < ga then -0.4 else 0 end
         + ng * 1.0 + na * 0.6 + (random() - 0.5) * 0.8 + (coalesce((effm->>pid::text)::numeric, 70) - 72) / 40.0;
    if info->>'g' = 'GK' then r := r + svs * 0.25 - ga * 0.35 + case when ga = 0 then 0.6 else 0 end;
    elsif info->>'g' = 'DEF' then r := r + case when ga = 0 then 0.5 else -0.15 * ga end; end if;
    if pid = any(reds) then r := r - 1.5; elsif pid = any(yel) then r := r - 0.2; end if;
    if pid = any(injured) then r := r - 0.3; end if;
    if mins < 30 then r := 6.0 + (r - 6.0) * 0.5; end if;
    r := round(least(10, greatest(3, r)), 1);
    rt := rt || jsonb_build_object(pid::text, r);
    if r > best then best := r; motm := pid; end if;
  end loop;

  update public.fixtures set hg = vh, ag = va, played = true, events = ev,
    stats = jsonb_build_object('poss', jsonb_build_array(round(posh * 100.0 / maxm), 100 - round(posh * 100.0 / maxm)),
      'shots', jsonb_build_array(sh_h, sh_a), 'on', jsonb_build_array(on_h, on_a),
      'lh', aH, 'la', aA, 'fh', H->>'formation', 'fa', A->>'formation', 'rt', rt, 'motm', motm,
      'end_h', to_jsonb(luH), 'end_a', to_jsonb(luA))
   where id = p_fix;

  if friendly then return; end if;

  -- maç sonrası: ceza sayacı, kondisyon, form, değer, kartlar, sakatlıklar
  update public.squads set ban = ban - 1
   where team_id in (fx.home, fx.away) and ban > 0 and not (player_id = any(usedH || usedA));
  for kv in select key, value from jsonb_each(pin) loop
    pid := kv.key::int; info := kv.value;
    mins := least(90, (info->>'out')::int) - (info->>'in')::int;
    if mins <= 0 or (rt->>pid::text) is null then continue; end if;
    r := (rt->>pid::text)::numeric;
    update public.squads q
       set fitness = greatest(20, q.fitness - round(case when info->>'g' = 'GK' then 6 else 18 + (100 - p.phy) * 0.12 end * mins / 90.0)::int),
           form = round(q.form * 0.7 + r * 0.3, 1),
           value = greatest(100000, round(q.value * (1 + (r - 6.5) * 0.01)))::bigint
      from public.real_players p
     where p.id = q.player_id and q.game_id = fx.game_id and q.player_id = pid
       and q.team_id = case info->>'s' when 'h' then fx.home else fx.away end;
  end loop;
  -- sarı kart birikimi: 5 sarı = 1 maç ceza
  update public.squads set yellows = yellows + 1 where game_id = fx.game_id and player_id = any(yel) and not (player_id = any(reds));
  for pid in select player_id from public.squads where game_id = fx.game_id and player_id = any(yel) and yellows >= 5 loop
    update public.squads set yellows = yellows - 5, ban = ban + 1 where game_id = fx.game_id and player_id = pid;
    select name into pl from public.real_players where id = pid;
    perform public._news(fx.game_id, (select team_id from public.squads where game_id = fx.game_id and player_id = pid), 'info', pl || ' 5. sarı kartını gördü: 1 maç ceza');
  end loop;
  -- kırmızı: çift sarı 1 maç, direkt kırmızı 2 maç
  for pid in select unnest(reds) loop
    update public.squads set ban = ban + case when pid = any(direct_red) then 2 else 1 end where game_id = fx.game_id and player_id = pid;
    select name into pl from public.real_players where id = pid;
    perform public._news(fx.game_id, (select team_id from public.squads where game_id = fx.game_id and player_id = pid), 'info',
      pl || ' kırmızı kart gördü: ' || case when pid = any(direct_red) then 2 else 1 end || ' maç ceza');
  end loop;
  -- sakatlık: 1-4 hafta
  for pid in select unnest(injured) loop
    update public.squads set injury = 1 + floor(random() * 4)::int where game_id = fx.game_id and player_id = pid returning injury into i;
    select name into pl from public.real_players where id = pid;
    perform public._news(fx.game_id, (select team_id from public.squads where game_id = fx.game_id and player_id = pid), 'info',
      '🚑 ' || pl || ' sakatlandı: ' || i || ' hafta yok');
  end loop;
end $function$;
