-- MENAJER ONLINE 021: moralin maça etkisi ve maç sonrası değişimi, sezon sonunda sözleşmeler ve altyapı. 020'den SONRA uygulanır.
CREATE OR REPLACE FUNCTION public._power(p_team uuid, p_lineup integer[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare t record; slots text[]; i int; p record; eff numeric; f numeric; base numeric;
  d numeric := 0; m numeric := 0; fw numeric := 0; gk numeric := 35; gkid int; nd int := 0; nm int := 0; nf int := 0;
  shooters jsonb := '[]'; players jsonb := '[]';
  ins jsonb; pr int; tp int; wd int; hs int;
begin
  select * into t from public.teams where id = p_team;
  slots := public._slots(t.formation);
  -- takım talimatları (kolon yoksa da çalışır): 0 düşük / 1 normal / 2 yüksek
  ins := coalesce(to_jsonb(t)->'instr', '{}'::jsonb);
  pr := least(2, greatest(0, coalesce((ins->>'press')::int, 1)));
  tp := least(2, greatest(0, coalesce((ins->>'tempo')::int, 1)));
  wd := least(2, greatest(0, coalesce((ins->>'width')::int, 1)));
  -- yapay zeka takımı: talimatı yoksa kimliğinden kalıcı bir oyun tarzı (istemcideki teamStyle ile aynı hesap)
  if coalesce(t.is_bot, false) and not (ins ? 'press') then
    select sum(ascii(substr(t.id::text, g, 1)) * g) into hs from generate_series(1, 36) g;
    pr := (array[0, 1, 1, 1, 2])[1 + hs % 5];
    tp := (array[0, 1, 1, 1, 2])[1 + (hs / 5) % 5];
    wd := (array[0, 1, 1, 1, 2])[1 + (hs / 25) % 5];
  end if;
  for i in 1..coalesce(cardinality(p_lineup), 0) loop
    select rp.id, rp.grp, rp.ovr, rp.sho, rp.phy, coalesce(q.ovr_delta, 0) dl, coalesce(q.fitness, 100) fit, coalesce(q.form, 6.5) frm, coalesce(q.morale, 70) mo
      into p from public.real_players rp left join public.squads q on q.player_id = rp.id and q.team_id = p_team
     where rp.id = p_lineup[i];
    f := (0.75 + 0.25 * p.fit / 100.0) * (1 + (p.frm - 6.5) * 0.02) * (1 + (p.mo - 70) * 0.0015);  -- moral ±%4.5
    base := p.ovr + p.dl;
    eff := (case when p.grp = slots[i] then base when slots[i] = 'GK' or p.grp = 'GK' then base * 0.5 else base * 0.85 end) * f;
    case slots[i]
      when 'GK' then gk := eff; gkid := p.id;
      when 'DEF' then d := d + eff; nd := nd + 1;
      when 'MID' then m := m + eff; nm := nm + 1;
      else fw := fw + eff; nf := nf + 1;
    end case;
    if slots[i] <> 'GK' then
      shooters := shooters || jsonb_build_object('id', p.id, 'w',
        (case slots[i] when 'FWD' then 3.0 when 'MID' then 1.3 else 0.35 end) * (case when p.sho > 0 then p.sho else p.ovr end) / 70.0,
        'q', ((case when p.sho > 0 then (p.sho + p.ovr) / 2.0 else p.ovr end) + p.dl) * f);
    end if;
    players := players || jsonb_build_object('id', p.id, 'g', slots[i], 'e', round(eff, 1), 'phy', p.phy, 'fit', p.fit);
  end loop;
  return jsonb_build_object(
    -- diziliş etkisi: hat başına oyuncu sayısı küçük bir çarpan (3'lü defans biraz zayıf, 5'li biraz güçlü)
    'def', (case when nd > 0 then d / nd else 40 end) * (0.94 + 0.02 * least(nd, 5)) * (1 - t.mentality * 0.03)
             * (1 - (pr - 1) * 0.025) * (1 - (wd - 1) * 0.01),  -- yüksek pres ve geniş oyun arkada boşluk bırakır
    'mid', (case when nm > 0 then m / nm else 40 end) * (0.9 + 0.033 * least(nm, 6)) * (1 + (pr - 1) * 0.03) * (1 - (tp - 1) * 0.02),
    'att', (case when nf > 0 then fw / nf else 40 end) * (0.92 + 0.04 * least(nf, 3)) * (1 + t.mentality * 0.04)
             * (1 + (tp - 1) * 0.03) * (1 + (wd - 1) * 0.015),
    'gk', gk, 'gkid', gkid, 'lineup', to_jsonb(p_lineup), 'formation', t.formation, 'shooters', shooters, 'players', players,
    'press', pr, 'tempo', tp, 'width', wd);
end $function$;

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
  wn int; wdri numeric; fdfn numeric; cz text; fac numeric;
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
    -- ceza sahasında olay: önce olası bir pozisyon, sonra oyunculara göre gerçekten faul/el olup olmadığı
    fac := 0;
    if random() < 0.0048 * least(greatest(ratio, 0.6), 1.5) ^ 2 and jsonb_array_length(atk->'shooters') > 0 then
      sd := case side when 'h' then 'a' else 'h' end;
      -- müdahale eden savunmacı (savunma değeri düşük olan daha çok faul yapar)
      select (x->>'id')::int, rp.dfn into fl, fdfn from jsonb_array_elements(dfn->'players') x join public.real_players rp on rp.id = (x->>'id')::int
       where x->>'g' in ('DEF', 'MID') and (x->>'id')::int = any(case side when 'h' then luA else luH end)
         and not ((x->>'id')::int = any(reds)) and not ((x->>'id')::int = any(injured))
       order by (x->>'g' = 'DEF') desc, random() * (110 - rp.dfn) desc limit 1;
      -- topla ceza sahasına giren hücumcu (dripling iyi olan daha sık)
      select (x->>'id')::int, rp.dri into wn, wdri from jsonb_array_elements(atk->'players') x join public.real_players rp on rp.id = (x->>'id')::int
       where x->>'g' in ('FWD', 'MID') and (x->>'id')::int = any(case side when 'h' then luH else luA end)
         and not ((x->>'id')::int = any(reds)) and not ((x->>'id')::int = any(injured))
       order by random() * rp.dri desc limit 1;
      cz := case when random() < 0.22 then 'hand' else 'foul' end;
      fac := case when cz = 'hand' then 0.7 else least(1.6, greatest(0.4, (coalesce(wdri, 70) / greatest(coalesce(fdfn, 70), 30)) ^ 2)) end;
      if random() * 1.6 >= fac or fl is null then fac := 0; end if;  -- temiz müdahale: penaltı yok
    end if;
    if fac > 0 then
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
      pe := jsonb_build_object('m', least(minute, 90), 's', side, 'p', (tk->>'id')::int, 'pen', true, 'f', fl, 'c', cz, 'w', wn);
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
      fk := random() < 0.05; -- direkt serbest vuruş: ceza sahası önünde faul
      pe := '{}'::jsonb;
      if fk then
        sd := case side when 'h' then 'a' else 'h' end;
        select (x->>'id')::int into fl from jsonb_array_elements(dfn->'players') x join public.real_players rp on rp.id = (x->>'id')::int
         where x->>'g' in ('DEF', 'MID') and (x->>'id')::int = any(case side when 'h' then luA else luH end)
           and not ((x->>'id')::int = any(reds)) order by random() * (110 - rp.dfn) desc limit 1;
        select (x->>'id')::int into wn from jsonb_array_elements(atk->'players') x
         where x->>'g' in ('FWD', 'MID') and (x->>'id')::int = any(case side when 'h' then luH else luA end)
           and (x->>'id')::int <> (sh->>'id')::int and not ((x->>'id')::int = any(reds)) order by random() limit 1;
        pe := jsonb_build_object('fk', true, 'f', fl, 'w', coalesce(wn, (sh->>'id')::int));
        if fl is not null and random() < 0.18 and not (fl = any(yel)) then -- faule sarı kart
          yel := yel || fl;
          ev := ev || jsonb_build_array(jsonb_build_object('m', least(minute, 90), 't', 'yellow', 's', sd, 'p', fl));
        end if;
      end if;
      if side = 'h' then sh_h := sh_h + 1; else sh_a := sh_a + 1; end if;
      if random() < 0.45 then
        if side = 'h' then on_h := on_h + 1; else on_a := on_a + 1; end if;
        gp := 0.275 * ((sh->>'q')::numeric / greatest((dfn->>'gk')::numeric, 20)) ^ 3;
        if random() < gp then
          ast := case when random() < 0.7 then public._pick_shooter(atk->'shooters') else null end;
          if ast is not null and ast->>'id' = sh->>'id' then ast := null; end if;
          ev := ev || jsonb_build_array(jsonb_build_object('m', least(minute, 90), 't','goal','s',side,'p',(sh->>'id')::int,'a',case when fk then null else (ast->>'id')::int end) || pe);
          if side = 'h' then vh := vh + 1; else va := va + 1; end if;
        else
          ev := ev || jsonb_build_array(jsonb_build_object('m', least(minute, 90), 't','save','s',side,'p',(sh->>'id')::int,'k',(dfn->>'gkid')::int) || pe);
        end if;
      else
        ev := ev || jsonb_build_array(jsonb_build_object('m', least(minute, 90), 't','miss','s',side,'p',(sh->>'id')::int) || pe);
      end if;
    elsif random() < 0.0125 * (1 + (coalesce((dfn->>'press')::int, 1) - 1) * 0.35) and jsonb_array_length(dfn->'shooters') > 0 then
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
       set fitness = greatest(20, q.fitness - round(case when info->>'g' = 'GK' then 6 else 18 + (100 - p.phy) * 0.12
             + (coalesce(((case info->>'s' when 'h' then H else A end)->>'press')::int, 1) - 1) * 4 end * mins / 90.0)::int),
           form = round(q.form * 0.7 + r * 0.3, 1),
           value = greatest(100000, round(q.value * (1 + (r - 6.5) * 0.01)))::bigint
      from public.real_players p
     where p.id = q.player_id and q.game_id = fx.game_id and q.player_id = pid
       and q.team_id = case info->>'s' when 'h' then fx.home else fx.away end;
  end loop;
  -- moral: sonuç ve maç puanı (oynayanlar); forma giyemeyen iyi oyuncular biraz bozulur; hepsi yavaşça 70'e döner
  for kv in select key, value from jsonb_each(pin) loop
    pid := kv.key::int; info := kv.value;
    if (rt->>pid::text) is null then continue; end if;
    if info->>'s' = 'h' then gf := vh; ga := va; else gf := va; ga := vh; end if;
    update public.squads set morale = least(100, greatest(5, morale + case when gf > ga then 5 when gf = ga then 1 else -5 end
                                      + round(((rt->>pid::text)::numeric - 6.5) * 3)::int))
     where game_id = fx.game_id and player_id = pid and team_id = case info->>'s' when 'h' then fx.home else fx.away end;
  end loop;
  update public.squads q set morale = greatest(25, q.morale - 2)
    from public.real_players p
   where p.id = q.player_id and q.team_id in (fx.home, fx.away) and not (q.player_id = any(usedH || usedA)) and p.ovr + q.ovr_delta >= 75;
  update public.squads set morale = morale + sign(70 - morale)::int where team_id in (fx.home, fx.away) and morale <> 70;
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
