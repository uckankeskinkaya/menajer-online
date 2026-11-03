-- MENAJER ONLINE 036: maç içi müdahale (execute_sql ile; yetkiler 037'de).
-- Kariyerde menajerin maçı 5 dakikada bir kayıt alınarak oynanır (stats.snaps). İlk yarı devre arasında durur; ikinci yarı
-- sona kadar "beklemede" oynanır (sonuç işlenmez). Menajer izlerken match_change ile müdahale ederse maç, izlediği dakikadan
-- sonraki ilk kayda geri sarılır, değişiklikler uygulanır ve oradan yeniden oynanır. finish_match (ya da "Devam et") sonucu işler.

create or replace function public._sim_fixture(p_fix bigint) returns void
language plpgsql security definer set search_path = '' as $$
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
  st jsonb; fromm int := 1; stopm int; bH numeric := 0; bA numeric := 0;
  tH jsonb; tA jsonb; isbh boolean; isba boolean; hold boolean; tac jsonb; nmt int; ty text; mult numeric; gpm numeric; u numeric; dif int;
  -- taktik/eşleşme sayıları (her dakika büyük jsonb okumamak için; takım değişince yeniden)
  hw int; ht2 int; hp int; aw int; at2 int; ap int; hwing numeric; hair numeric; hpace numeric; hfb numeric; hcb numeric; hdp numeric; hmt numeric; hlsh numeric; hmid numeric;
  awing numeric; aair numeric; apace numeric; afb numeric; acb numeric; adp numeric; amt numeric; alsh numeric; amid numeric; hatt numeric; aatt numeric; hdef numeric; adef numeric;
  dirty boolean := true; xw int; xt int; xp int; yw int; yp int; c1 numeric; c2 numeric; c3 numeric; c4 numeric;
begin
  select * into fx from public.fixtures where id = p_fix;
  friendly := fx.comp = 'friendly';
  stopm := nullif(fx.stats->>'stop', '')::int;
  hold := coalesce((fx.stats->>'hold')::boolean, false); -- sona kadar oyna ama sonuçlandırma (menajer izlerken müdahale edebilsin)
  if fx.stats ? 'ht' then
    -- ikinci yarı: devre arasında kaydedilen durum (menajerin değişiklikleri play_second_half ile işlendi)
    st := fx.stats->'ht'; fromm := coalesce((st->>'next')::int, 46);
    vh := (st->>'vh')::int; va := (st->>'va')::int; ev := st->'ev'; posh := (st->>'posh')::int;
    sh_h := (st->>'sh_h')::int; sh_a := (st->>'sh_a')::int; on_h := (st->>'on_h')::int; on_a := (st->>'on_a')::int;
    luH := array(select jsonb_array_elements_text(st->'luH')::int); luA := array(select jsonb_array_elements_text(st->'luA')::int);
    usedH := array(select jsonb_array_elements_text(st->'usedH')::int); usedA := array(select jsonb_array_elements_text(st->'usedA')::int);
    subsH := (st->>'subsH')::int; subsA := (st->>'subsA')::int; missH := (st->>'missH')::int; missA := (st->>'missA')::int;
    subMinH := (st->>'subMinH')::int; subMinA := (st->>'subMinA')::int; injMinH := (st->>'injMinH')::int; injMinA := (st->>'injMinA')::int;
    reds := array(select jsonb_array_elements_text(st->'reds')::int); yel := array(select jsonb_array_elements_text(st->'yel')::int); injured := array(select jsonb_array_elements_text(st->'injured')::int); direct_red := array(select jsonb_array_elements_text(st->'direct_red')::int);
    pin := st->'pin'; effm := st->'effm'; maxm := (st->>'maxm')::int; aH := st->'aH'; aA := st->'aA';
    bH := coalesce((st->>'bH')::numeric, 0); bA := coalesce((st->>'bA')::numeric, 0);
    select is_bot into isbh from public.teams where id = fx.home; select is_bot into isba from public.teams where id = fx.away;
    -- menajer taktiğini maç içinde değiştirmiş olabilir: takım kaydından; yapay zeka maç içi taktiğini sürdürür
    tH := case when isbh then coalesce(st->'tH', public._ai_tactic(fx.home, fx.away)) else public._team_tactic(fx.home) end;
    tA := case when isba then coalesce(st->'tA', public._ai_tactic(fx.away, fx.home)) else public._team_tactic(fx.away) end;
    H := public._power2(fx.home, luH, tH); A := public._power2(fx.away, luA, tA);
    slH := public._slots(H->>'formation'); slA := public._slots(A->>'formation');
    if stopm is not null and stopm < fromm then stopm := null; end if;
  else
    select is_bot into isbh from public.teams where id = fx.home; select is_bot into isba from public.teams where id = fx.away;
    tH := case when isbh then public._ai_tactic(fx.home, fx.away) else public._team_tactic(fx.home) end;
    tA := case when isba then public._ai_tactic(fx.away, fx.home) else public._team_tactic(fx.away) end;
    H := public._power2(fx.home, public._fix_lineup(fx.home), tH); A := public._power2(fx.away, public._fix_lineup(fx.away), tA);
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
  end if;

  for minute in fromm..least(maxm, coalesce(stopm, maxm)) loop
    -- sakatlık ve oyuncu değişiklikleri
    for k in 1..2 loop
      if k = 1 then sd := 'h'; tid := fx.home; lu := luH; used := usedH; subs := subsH; miss := missH; smin := subMinH; imin := injMinH; sl := slH; P := H;
      else sd := 'a'; tid := fx.away; lu := luA; used := usedA; subs := subsA; miss := missA; smin := subMinA; imin := injMinA; sl := slA; P := A; end if;
      chg := false;
      -- yapay zeka: gerideyse hücuma geçer, öndeyse sona doğru skoru korur
      if (case k when 1 then isbh else isba end) and minute in (60, 72, 82) then
        tac := case k when 1 then tH else tA end;
        dif := case k when 1 then vh - va else va - vh end;
        nmt := (tac->>'ment')::int;
        if dif < 0 then nmt := least(2, greatest(nmt, 0) + case when minute >= 72 then 2 else 1 end);
        elsif dif > 0 and minute >= 72 then nmt := greatest(-2, least(nmt, 0) - 1); end if;
        nmt := least(2, greatest(-2, nmt));
        if nmt <> (tac->>'ment')::int then
          tac := tac || jsonb_build_object('ment', nmt, 'press', case when dif < 0 then greatest((tac->>'press')::int, 1) else (tac->>'press')::int end);
          if k = 1 then tH := tac; else tA := tac; end if;
          chg := true;
          ev := ev || jsonb_build_array(jsonb_build_object('m', minute, 't', 'tac', 's', sd, 'mm', nmt));
        end if;
      end if;
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
        dirty := true;
        P := public._power2(tid, lu, case k when 1 then tH else tA end);
        for info in select x from jsonb_array_elements(P->'players') x loop effm := effm || jsonb_build_object(info->>'id', info->'e'); end loop;
      end if;
      -- kırmızı kart görenler ve yerine giremeyen sakatlar şut atamaz
      if chg or minute = 1 or cardinality(reds) + cardinality(injured) > 0 then
        P := jsonb_set(P, '{shooters}', coalesce((select jsonb_agg(x) from jsonb_array_elements(P->'shooters') x
               where (x->>'id')::int = any(lu) and not ((x->>'id')::int = any(reds)) and not ((x->>'id')::int = any(injured))), '[]'));
      end if;
      if k = 1 then luH := lu; usedH := used; subsH := subs; missH := miss; H := P; else luA := lu; usedA := used; subsA := subs; missA := miss; A := P; end if;
    end loop;

    if dirty then -- taktik ve eşleşme sayıları
      hw := (H->>'width')::int; ht2 := (H->>'tempo')::int; hp := (H->>'press')::int; aw := (A->>'width')::int; at2 := (A->>'tempo')::int; ap := (A->>'press')::int;
      hwing := (H->>'wing')::numeric; hair := (H->>'air')::numeric; hpace := (H->>'pace')::numeric; hfb := (H->>'fbdef')::numeric; hcb := (H->>'cbair')::numeric;
      hdp := (H->>'dpace')::numeric; hmt := (H->>'midtech')::numeric; hlsh := (H->>'lsh')::numeric; hmid := (H->>'mid')::numeric; hatt := (H->>'att')::numeric; hdef := (H->>'def')::numeric;
      awing := (A->>'wing')::numeric; aair := (A->>'air')::numeric; apace := (A->>'pace')::numeric; afb := (A->>'fbdef')::numeric; acb := (A->>'cbair')::numeric;
      adp := (A->>'dpace')::numeric; amt := (A->>'midtech')::numeric; alsh := (A->>'lsh')::numeric; amid := (A->>'mid')::numeric; aatt := (A->>'att')::numeric; adef := (A->>'def')::numeric;
      dirty := false;
    end if;
    -- eksik oyuncu (kırmızı / değiştirilemeyen sakat) başına %10 güç kaybı
    mH := power(0.9, missH) * (1 + bH); mA := power(0.9, missA) * (1 + bA);  -- devre arası konuşmasının etkisi
    ph := (hmid * mH) ^ 2 / ((hmid * mH) ^ 2 + (amid * mA) ^ 2) + 0.03 + (at2 - ht2) * 0.025;
    if random() < ph then side := 'h'; atk := H; dfn := A; posh := posh + 1;
      ratio := (hatt * 0.6 + hmid * 0.4) * mH / (adef * mA);
    else side := 'a'; atk := A; dfn := H;
      ratio := (aatt * 0.6 + amid * 0.4) * mA / (hdef * mH);
    end if;
    -- atak türü: kanat ortası / savunma arkası / uzaktan / kısa paslarla merkezden (taktiğe göre ağırlık)
    if side = 'h' then xw := hw; xt := ht2; yw := aw; yp := ap; else xw := aw; xt := at2; yw := hw; yp := hp; end if;
    c1 := 0.26 * (1 + (xw - 1) * 0.7); c2 := 0.27 * (1 + (xt - 1) * 0.55); c3 := 0.14 * (1 + (xt - 1) * 0.2);
    c4 := 0.33 * (1 - (xw - 1) * 0.45) * (1 - (xt - 1) * 0.35);
    u := random() * (c1 + c2 + c3 + c4);
    ty := case when u < c1 then 'cross' when u < c1 + c2 then 'thru' when u < c1 + c2 + c3 then 'long' else 'combo' end;
    -- eşleşme: kanatçılar rakip beklere, forvetin hava gücü stoperlere, forvetin hızı savunma hızına ve pres yüksekliğine karşı
    if side = 'h' then
      mult := case ty
        when 'cross' then least(1.6, greatest(0.6, (hwing / afb) ^ 1.6 * (hair / acb))) * case yw when 0 then 1.12 when 2 then 0.94 else 1 end
        when 'thru' then least(1.6, greatest(0.6, (hpace / adp) ^ 1.5)) * case yp when 2 then 1.18 when 0 then 0.84 else 1 end
        when 'long' then least(1.5, greatest(0.6, (hlsh / 70) ^ 2.2)) * case yp when 0 then 1.15 when 2 then 0.92 else 1 end
        else least(1.5, greatest(0.6, (hmt / greatest(amid, 30)) ^ 1.2)) * case yw when 2 then 1.1 when 0 then 0.88 else 1 end end;
    else
      mult := case ty
        when 'cross' then least(1.6, greatest(0.6, (awing / hfb) ^ 1.6 * (aair / hcb))) * case yw when 0 then 1.12 when 2 then 0.94 else 1 end
        when 'thru' then least(1.6, greatest(0.6, (apace / hdp) ^ 1.5)) * case yp when 2 then 1.18 when 0 then 0.84 else 1 end
        when 'long' then least(1.5, greatest(0.6, (alsh / 70) ^ 2.2)) * case yp when 0 then 1.15 when 2 then 0.92 else 1 end
        else least(1.5, greatest(0.6, (amt / greatest(hmid, 30)) ^ 1.2)) * case yw when 2 then 1.1 when 0 then 0.88 else 1 end end;
    end if;
    gpm := case ty when 'cross' then 0.92 when 'thru' then 1.12 when 'long' then 0.62 else 1.0 end;
    shp := 0.22 * ratio ^ 5 * mult;
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
      select x into sh from jsonb_array_elements(atk->'shooters') x
       order by -ln(greatest(random(), 1e-9)) / greatest(0.01, (x->>'w')::numeric * case ty
         when 'cross' then (case x->>'g' when 'FWD' then 1.5 when 'MID' then 0.7 else 0.5 end) * coalesce((x->>'phy')::numeric, 70) / 70
         when 'thru' then (case x->>'g' when 'FWD' then 1.3 when 'MID' then 0.8 else 0.2 end) * coalesce((x->>'pac')::numeric, 70) / 70
         when 'long' then (case x->>'g' when 'MID' then 2.4 when 'FWD' then 0.7 else 0.5 end) * coalesce((x->>'sho')::numeric, 60) / 70
         else 1 end) limit 1;
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
        gp := 0.275 * gpm * ((sh->>'q')::numeric / greatest((dfn->>'gk')::numeric, 20)) ^ 3;
        if random() < gp then
          ast := case when random() < 0.7 then public._pick_shooter(atk->'shooters') else null end;
          if ast is not null and ast->>'id' = sh->>'id' then ast := null; end if;
          ev := ev || jsonb_build_array(jsonb_build_object('m', least(minute, 90), 't','goal','s',side,'p',(sh->>'id')::int,'a',case when fk then null else (ast->>'id')::int end, 'k', ty) || pe);
          if side = 'h' then vh := vh + 1; else va := va + 1; end if;
        else
          ev := ev || jsonb_build_array(jsonb_build_object('m', least(minute, 90), 't','save','s',side,'p',(sh->>'id')::int,'k',(dfn->>'gkid')::int, 'ty', ty) || pe);
        end if;
      else
        ev := ev || jsonb_build_array(jsonb_build_object('m', least(minute, 90), 't','miss','s',side,'p',(sh->>'id')::int, 'ty', ty) || pe);
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

  if (stopm is not null and stopm < maxm) or hold then
    -- ara durak (devre arası ya da müdahale kaydı) ya da beklemede tam maç: durum kaydedilir, sonuç henüz işlenmez
    if stopm is null or stopm >= maxm then stopm := maxm; end if;
    st := jsonb_build_object('vh', vh, 'va', va, 'ev', ev, 'posh', posh, 'sh_h', sh_h, 'sh_a', sh_a, 'on_h', on_h, 'on_a', on_a,
      'luH', to_jsonb(luH), 'luA', to_jsonb(luA), 'usedH', to_jsonb(usedH), 'usedA', to_jsonb(usedA),
      'subsH', subsH, 'subsA', subsA, 'missH', missH, 'missA', missA, 'subMinH', subMinH, 'subMinA', subMinA,
      'injMinH', injMinH, 'injMinA', injMinA, 'reds', to_jsonb(reds), 'yel', to_jsonb(yel), 'injured', to_jsonb(injured),
      'direct_red', to_jsonb(direct_red), 'pin', pin, 'effm', effm, 'maxm', maxm, 'aH', aH, 'aA', aA, 'bH', bH, 'bA', bA,
      'tH', tH, 'tA', tA, 'next', case when stopm >= maxm then maxm + 1 else stopm + 1 end);
    update public.fixtures set hg = vh, ag = va, events = ev,
      stats = jsonb_build_object('ht', st, 'poss', jsonb_build_array(round(posh * 100.0 / stopm), 100 - round(posh * 100.0 / stopm)),
        'shots', jsonb_build_array(sh_h, sh_a), 'on', jsonb_build_array(on_h, on_a), 'lh', aH, 'la', aA, 'fh', H->>'formation', 'fa', A->>'formation',
        'tH', tH, 'tA', tA)
     where id = p_fix;
    return;
  end if;

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
      'end_h', to_jsonb(luH), 'end_a', to_jsonb(luA), 'tH', tH, 'tA', tA)
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
    update public.squads set morale = least(100, greatest(5, morale + case when gf > ga then 4 when gf = ga then 1 else -4 end
                                      + round(((rt->>pid::text)::numeric - 6.5) * 2)::int))
     where game_id = fx.game_id and player_id = pid and team_id = case info->>'s' when 'h' then fx.home else fx.away end;
  end loop;
  update public.squads q set morale = greatest(25, q.morale - 2)
    from public.real_players p
   where p.id = q.player_id and q.team_id in (fx.home, fx.away) and not (q.player_id = any(usedH || usedA)) and p.ovr + q.ovr_delta >= 75;
  update public.squads set morale = morale + round((70 - morale) * 0.1)::int + sign(70 - morale)::int where team_id in (fx.home, fx.away) and morale <> 70;
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
end $$;



-- maçı p_to'ya kadar oyna (45 = devre arası, 0 = sona kadar beklemede), 5 dakikada bir durum kaydı al
create or replace function public._sim_run(p_fix bigint, p_to int) returns void
language plpgsql security definer set search_path = '' as $$
declare fx record; snaps jsonb; cur int; s int; lim int; stx jsonb;
begin
  select * into fx from public.fixtures where id = p_fix;
  snaps := coalesce(fx.stats->'snaps', '{}'::jsonb);
  cur := coalesce((fx.stats->'ht'->>'next')::int, 1) - 1;
  lim := case when p_to = 45 then 45 else 90 end;
  s := (cur / 5 + 1) * 5;
  while s < lim loop
    update public.fixtures set stats = (coalesce(stats, '{}'::jsonb) || jsonb_build_object('stop', s)) - 'hold' where id = p_fix;
    perform public._sim_fixture(p_fix);
    select stats into stx from public.fixtures where id = p_fix;
    snaps := snaps || jsonb_build_object(s::text, stx->'ht');
    s := s + 5;
  end loop;
  if p_to = 45 then
    if cur < 45 then
      update public.fixtures set stats = (coalesce(stats, '{}'::jsonb) || '{"stop": 45}'::jsonb) - 'hold' where id = p_fix;
      perform public._sim_fixture(p_fix);
    end if;
    select stats into stx from public.fixtures where id = p_fix;
    snaps := snaps || jsonb_build_object('45', stx->'ht');
  else
    update public.fixtures set stats = (coalesce(stats, '{}'::jsonb) || '{"hold": true}'::jsonb) - 'stop' where id = p_fix;
    perform public._sim_fixture(p_fix);
  end if;
  update public.fixtures set stats = stats || jsonb_build_object('snaps', snaps) where id = p_fix;
end $$;

-- maç içi müdahale: izlenen dakikadan sonraki ilk kayda dönülür, değişiklikler uygulanır, maç oradan yeniden oynanır
create or replace function public.match_change(p_game uuid, p_minute int, p_mentality int, p_lineup int[], p_press int, p_tempo int, p_width int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); tm record; fx record; sn int; st jsonb; sd text; S text; oldlu int[]; newlu int[]; used int[]; reds int[];
  subs int; incoming int[]; sl text[]; i int; pin jsonb; ev jsonb; snaps jsonb; m1 int;
begin
  if uid is null then return jsonb_build_object('ok', false, 'msg', 'Giriş yapmalısın'); end if;
  select * into tm from public.teams where game_id = p_game and owner = uid for update;
  if not found then return jsonb_build_object('ok', false, 'msg', 'Bu odada takımın yok'); end if;
  select * into fx from public.fixtures where game_id = p_game and not played and stats ? 'snaps' and (home = tm.id or away = tm.id) for update;
  if not found then return jsonb_build_object('ok', false, 'msg', 'Müdahale edilebilecek bir maçın yok'); end if;
  select min(k::int) into sn from jsonb_object_keys(fx.stats->'snaps') k where k::int > coalesce(p_minute, 0);
  if sn is null or sn >= 89 then return jsonb_build_object('ok', false, 'msg', 'Maçın bitmesine çok az kaldı'); end if;
  st := fx.stats->'snaps'->(sn::text);
  m1 := sn + 1;
  if fx.home = tm.id then sd := 'h'; S := 'H'; else sd := 'a'; S := 'A'; end if;
  oldlu := array(select jsonb_array_elements_text(st->('lu' || S))::int);
  used := array(select jsonb_array_elements_text(st->('used' || S))::int);
  reds := array(select jsonb_array_elements_text(st->'reds')::int);
  subs := (st->>('subs' || S))::int;
  newlu := coalesce(p_lineup, oldlu);
  if cardinality(newlu) <> cardinality(oldlu) or (select count(distinct x) from unnest(newlu) x) <> cardinality(newlu) then
    return jsonb_build_object('ok', false, 'msg', 'İlk 11 geçersiz'); end if;
  if exists (select 1 from unnest(oldlu) x where x = any(reds) and not (x = any(newlu))) then
    return jsonb_build_object('ok', false, 'msg', 'Kırmızı kart gören oyuncunun yerine oyuncu giremez'); end if;
  incoming := array(select x from unnest(newlu) x where not (x = any(oldlu)));
  if exists (select 1 from unnest(incoming) x where x = any(used)) then
    return jsonb_build_object('ok', false, 'msg', 'Oyundan çıkan oyuncu geri giremez'); end if;
  if cardinality(incoming) > 3 - subs then
    return jsonb_build_object('ok', false, 'msg', 'Kalan değişiklik hakkın: ' || (3 - subs)); end if;
  if exists (select 1 from unnest(incoming) x where not exists (select 1 from public.squads q where q.team_id = tm.id and q.player_id = x and q.injury = 0 and q.ban = 0)) then
    return jsonb_build_object('ok', false, 'msg', 'Giren oyuncu kadronda değil ya da sakat/cezalı'); end if;
  sl := public._slots(tm.formation);
  pin := st->'pin'; ev := st->'ev';
  for i in 1..cardinality(newlu) loop
    if not (newlu[i] = any(oldlu)) then
      pin := jsonb_set(pin, array[oldlu[i]::text, 'out'], to_jsonb(least(m1, 90)));
      pin := pin || jsonb_build_object(newlu[i]::text, jsonb_build_object('s', sd, 'in', least(m1, 90), 'out', 90, 'g', sl[i]));
      ev := ev || jsonb_build_array(jsonb_build_object('m', least(m1, 90), 't', 'sub', 's', sd, 'p', oldlu[i], 'a', newlu[i]));
    elsif newlu[i] <> oldlu[i] then
      return jsonb_build_object('ok', false, 'msg', 'Oyuncuların yerini değiştirme; değişiklik aynı mevkiye yapılır');
    end if;
  end loop;
  st := jsonb_set(st, array['lu' || S], to_jsonb(newlu));
  st := jsonb_set(st, array['used' || S], to_jsonb(used || incoming));
  st := jsonb_set(st, array['subs' || S], to_jsonb(subs + cardinality(incoming)));
  st := jsonb_set(st, '{pin}', pin); st := jsonb_set(st, '{ev}', ev);
  -- menajerin taktiği (takım kaydına yazılır; maç bu andan itibaren yeni taktikle oynanır)
  update public.teams set mentality = greatest(-2, least(2, coalesce(p_mentality, tm.mentality))), lineup = newlu,
    instr = case when p_press is null then instr else jsonb_build_object('press', greatest(0, least(2, p_press)), 'tempo', greatest(0, least(2, coalesce(p_tempo, 1))), 'width', greatest(0, least(2, coalesce(p_width, 1)))) end
   where id = tm.id;
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) into snaps from jsonb_each(fx.stats->'snaps') x(k, v) where k::int <= sn;
  update public.fixtures set hg = (st->>'vh')::int, ag = (st->>'va')::int, events = ev,
    stats = (fx.stats - 'ht' - 'snaps' - 'hold' - 'stop') || jsonb_build_object('ht', st, 'snaps', snaps)
   where id = fx.id;
  if sn < 45 then perform public._sim_run(fx.id, 45);
  elsif sn > 45 then perform public._sim_run(fx.id, 0);
  end if; -- s = 45: devre arasında bekler, konuşma yapılır
  return jsonb_build_object('ok', true, 'from', m1, 'msg', case when sn = 45 then 'Değişiklikler devre arasında yapılacak' else 'Değişiklikler ' || m1 || '. dakikada oyuna giriyor' end);
end $$;

-- izlenen maçı sonuçlandır (puan, kart, moral, ödüller); hafta bittiyse hafta sonunu çalıştır
create or replace function public.finish_match(p_game uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); tm record; fx record;
begin
  if uid is null then return jsonb_build_object('ok', false, 'msg', 'Giriş yapmalısın'); end if;
  select * into tm from public.teams where game_id = p_game and owner = uid;
  if not found then return jsonb_build_object('ok', false, 'msg', 'Bu odada takımın yok'); end if;
  select * into fx from public.fixtures where game_id = p_game and not played and stats ? 'ht' and (home = tm.id or away = tm.id)
     and coalesce((stats->'ht'->>'next')::int, 46) > coalesce((stats->'ht'->>'maxm')::int, 90) for update;
  if not found then return jsonb_build_object('ok', true, 'msg', 'Bekleyen maç yok'); end if;
  perform public._play_fixture(fx.id);
  if not exists (select 1 from public.fixtures where game_id = p_game and round = fx.round and not played and comp <> 'friendly') then
    perform public._after_round(p_game, fx.round);
  end if;
  return jsonb_build_object('ok', true, 'msg', 'Maç tamamlandı');
end $$;


create or replace function public.play_second_half(p_game uuid, p_talk int, p_mentality int, p_lineup int[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); tm record; fx record; st jsonb; sd text; S text; oldlu int[]; newlu int[]; used int[]; reds int[];
  injured int[]; subs int; incoming int[]; outgoing int[]; sl text[]; i int; gf int; ga int; d int; boost numeric; pin jsonb; ev jsonb;
  opp record; msg text; ob numeric := 0;
begin
  if uid is null then return jsonb_build_object('ok', false, 'msg', 'Giriş yapmalısın'); end if;
  if p_talk is null or p_talk not between 0 and 2 then return jsonb_build_object('ok', false, 'msg', 'Takım konuşmasını seç'); end if;
  select * into tm from public.teams where game_id = p_game and owner = uid for update;
  if not found then return jsonb_build_object('ok', false, 'msg', 'Bu odada takımın yok'); end if;
  select * into fx from public.fixtures where game_id = p_game and not played and stats ? 'ht' and (home = tm.id or away = tm.id) for update;
  if not found then return jsonb_build_object('ok', false, 'msg', 'Devre arasında bekleyen maçın yok'); end if;
  st := fx.stats->'ht';
  if coalesce((st->>'next')::int, 46) <> 46 then return jsonb_build_object('ok', false, 'msg', 'Devre arasında bekleyen maçın yok'); end if;
  if fx.home = tm.id then sd := 'h'; S := 'H'; gf := (st->>'vh')::int; ga := (st->>'va')::int;
  else sd := 'a'; S := 'A'; gf := (st->>'va')::int; ga := (st->>'vh')::int; end if;
  oldlu := array(select jsonb_array_elements_text(st->('lu' || S))::int);
  used := array(select jsonb_array_elements_text(st->('used' || S))::int);
  reds := array(select jsonb_array_elements_text(st->'reds')::int);
  injured := array(select jsonb_array_elements_text(st->'injured')::int);
  subs := (st->>('subs' || S))::int;
  newlu := coalesce(p_lineup, oldlu);
  -- oyuncu değişiklikleri: aynı mevkiye, kalan hak kadar
  if cardinality(newlu) <> cardinality(oldlu) or (select count(distinct x) from unnest(newlu) x) <> cardinality(newlu) then
    return jsonb_build_object('ok', false, 'msg', 'İlk 11 geçersiz'); end if;
  if exists (select 1 from unnest(oldlu) x where x = any(reds) and not (x = any(newlu))) then
    return jsonb_build_object('ok', false, 'msg', 'Kırmızı kart gören oyuncunun yerine oyuncu giremez'); end if;
  incoming := array(select x from unnest(newlu) x where not (x = any(oldlu)));
  outgoing := array(select x from unnest(oldlu) x where not (x = any(newlu)));
  if exists (select 1 from unnest(incoming) x where x = any(used)) then
    return jsonb_build_object('ok', false, 'msg', 'Oyundan çıkan oyuncu geri giremez'); end if;
  if cardinality(incoming) > 3 - subs then
    return jsonb_build_object('ok', false, 'msg', 'Kalan değişiklik hakkın: ' || (3 - subs)); end if;
  if exists (select 1 from unnest(incoming) x where not exists (select 1 from public.squads q where q.team_id = tm.id and q.player_id = x and q.injury = 0 and q.ban = 0)) then
    return jsonb_build_object('ok', false, 'msg', 'Giren oyuncu kadronda değil ya da sakat/cezalı'); end if;
  sl := public._slots(tm.formation);
  pin := st->'pin'; ev := st->'ev';
  for i in 1..cardinality(newlu) loop
    if not (newlu[i] = any(oldlu)) then
      pin := jsonb_set(pin, array[oldlu[i]::text, 'out'], to_jsonb(45));
      pin := pin || jsonb_build_object(newlu[i]::text, jsonb_build_object('s', sd, 'in', 45, 'out', 90, 'g', sl[i]));
      ev := ev || jsonb_build_array(jsonb_build_object('m', 46, 't', 'sub', 's', sd, 'p', oldlu[i], 'a', newlu[i]));
    elsif newlu[i] <> oldlu[i] then
      return jsonb_build_object('ok', false, 'msg', 'Oyuncuların yerini değiştirme; değişiklik aynı mevkiye yapılır');
    end if;
  end loop;
  -- takım konuşması: etkisi skora bağlı (ikinci yarı boyunca takım gücüne ±%3)
  d := sign(gf - ga);
  boost := (array[[0.02, -0.015, 0.025], [0.01, 0.02, 0], [0, 0.03, -0.02]])[case d when 1 then 1 when 0 then 2 else 3 end][p_talk + 1];
  msg := (array[
    ['Oyuncular sakin, işi bitirmeye odaklı.', 'Öndeyken bağırmak gerginlik yarattı.', 'Övgüler oyunculara güven verdi.'],
    ['Sakinlik iyi geldi.', 'Sert konuşma oyuncuları ateşledi!', 'Övgüler pek etki etmedi.'],
    ['Sakin konuşma pek etki etmedi.', 'Sert konuşma oyuncuları ateşledi!', 'Gerideyken övmek oyuncuları rahatlattı, fazla rahat.']])[case d when 1 then 1 when 0 then 2 else 3 end][p_talk + 1];
  st := jsonb_set(st, array['lu' || S], to_jsonb(newlu));
  st := jsonb_set(st, array['used' || S], to_jsonb(used || incoming));
  st := jsonb_set(st, array['subs' || S], to_jsonb(subs + cardinality(incoming)));
  st := jsonb_set(st, array['b' || S], to_jsonb(boost));
  st := jsonb_set(st, '{pin}', pin); st := jsonb_set(st, '{ev}', ev);
  -- rakip yapay zekaysa ve gerideyse ikinci yarıya hücumla çıkar
  select * into opp from public.teams where id = case when sd = 'h' then fx.away else fx.home end;
  if opp.is_bot and d > 0 then ob := 0.015; msg := msg || ' Rakip ikinci yarıya hücumla çıkıyor.'; end if;
  st := jsonb_set(st, array['b' || case when S = 'H' then 'A' else 'H' end], to_jsonb(ob));
  update public.teams set mentality = greatest(-2, least(2, coalesce(p_mentality, tm.mentality))), lineup = newlu where id = tm.id;
  update public.fixtures set stats = jsonb_set(stats, '{ht}', st) where id = fx.id;
  perform public._sim_run(fx.id, 0);  -- ikinci yarı beklemede: izlerken müdahale edilebilir, maç sonu finish_match ile işlenir
  return jsonb_build_object('ok', true, 'msg', msg, 'fixture', fx.id, 'boost', boost);
end $$;



create or replace function public._play_round(p_game uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r int; f record; n int := 0; s jsonb; ht bigint;
begin
  perform public.resolve_transfers();
  -- devre arasında bekleyen maç varsa önce o tamamlanır
  select id into ht from public.fixtures where game_id = p_game and not played and stats ? 'ht' limit 1;
  if ht is not null then
    if (select coalesce((stats->'ht'->>'next')::int, 46) > coalesce((stats->'ht'->>'maxm')::int, 90) from public.fixtures where id = ht) then
      -- izlenmeden bırakılan maç: sonuçlandır, haftayı kapat, sonraki haftaya geç
      select round into r from public.fixtures where id = ht;
      perform public._play_fixture(ht);
      if not exists (select 1 from public.fixtures where game_id = p_game and round = r and not played and comp <> 'friendly') then
        perform public._after_round(p_game, r);
      end if;
      ht := null;
      if (select status from public.games where id = p_game) <> 'active' then return jsonb_build_object('ok', true, 'played', 0); end if;
    else
      return jsonb_build_object('ok', true, 'halftime', ht, 'played', 0);
    end if;
  end if;
  s := public._settings(p_game);
  select min(round) into r from public.fixtures where game_id = p_game and not played and comp <> 'friendly';
  if r is null then raise exception 'Oynanacak maç yok'; end if;
  for f in select x.id, x.home, x.away from public.fixtures x where x.game_id = p_game and x.round = r and not x.played and x.comp <> 'friendly' order by x.kickoff_at nulls last, x.id loop
    -- kariyerde menajerin maçı devre arasında durur
    if coalesce((s->>'career')::boolean, false) and coalesce((s->>'halftime')::boolean, true)
       and exists (select 1 from public.teams t where t.id in (f.home, f.away) and not t.is_bot) then
      perform public._sim_run(f.id, 45);  -- ilk yarı, 5 dakikada bir kayıtla; devre arasında durur
      ht := f.id;
    else
      perform public._play_fixture(f.id);
    end if;
    n := n + 1;
  end loop;
  if ht is not null and exists (select 1 from public.fixtures where id = ht and not played) then
    return jsonb_build_object('ok', true, 'round', r, 'played', n, 'halftime', ht);
  end if;
  perform public._after_round(p_game, r);
  return jsonb_build_object('ok', true, 'round', r, 'played', n);
end $$;


