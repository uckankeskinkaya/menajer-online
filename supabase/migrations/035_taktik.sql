-- MENAJER ONLINE 035: gerçekçi taktikler (execute_sql ile).
-- _power2: _power + taktik (pres/tempo/genişlik/oyun anlayışı, dışarıdan verilebilir) + eşleşme özellikleri:
--   wing (kanatların hız/dripling/pas), air (forvetin hava gücü), pace (forvet hızı), fbdef (beklerin savunması),
--   cbair (stoperlerin hava gücü), dpace (savunmanın hızı), midtech (orta sahanın pası), lsh (uzaktan şut).
-- _ai_tactic: yapay zeka maça rakibine göre taktik seçer (güçlüye karşı kontra, zayıfa karşı baskı, kanatçısı iyiyse kanat oyunu).

create or replace function public._power2(p_team uuid, p_lineup int[], p_tac jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t record; slots text[]; i int; p record; eff numeric; f numeric; base numeric;
  d numeric := 0; m numeric := 0; fw numeric := 0; gk numeric := 35; gkid int; nd int := 0; nm int := 0; nf int := 0;
  shooters jsonb := '[]'; players jsonb := '[]';
  ins jsonb; pr int; tp int; wd int; mt int; hs int;
  parts int[]; li int; pos int; cnt int; wide boolean; lineof int[] := '{}'; posin int[] := '{}'; linecnt int[] := '{}';
  wing numeric := 0; nwing int := 0; air numeric := 0; pace numeric := 0; npace int := 0; fbdef numeric := 0; nfb int := 0;
  cbair numeric := 0; ncb int := 0; dpace numeric := 0; ndp int := 0; midtech numeric := 0; nmt int := 0; lsh numeric := 0; nls int := 0;
begin
  select * into t from public.teams where id = p_team;
  slots := public._slots(t.formation);
  -- her slotun hattı ve hattaki sırası (kanat mı?)
  parts := string_to_array(t.formation, '-')::int[];
  lineof := array[0]; posin := array[0]; linecnt := array[1];
  for li in 1..cardinality(parts) loop
    for pos in 1..parts[li] loop lineof := lineof || li; posin := posin || pos; linecnt := linecnt || parts[li]; end loop;
  end loop;
  ins := coalesce(to_jsonb(t)->'instr', '{}'::jsonb);
  pr := least(2, greatest(0, coalesce((p_tac->>'press')::int, (ins->>'press')::int, 1)));
  tp := least(2, greatest(0, coalesce((p_tac->>'tempo')::int, (ins->>'tempo')::int, 1)));
  wd := least(2, greatest(0, coalesce((p_tac->>'width')::int, (ins->>'width')::int, 1)));
  mt := least(2, greatest(-2, coalesce((p_tac->>'ment')::int, t.mentality, 0)));
  if coalesce(t.is_bot, false) and not (ins ? 'press') and not (p_tac ? 'press') then
    select sum(ascii(substr(t.id::text, g, 1)) * g) into hs from generate_series(1, 36) g;
    pr := (array[0, 1, 1, 1, 2])[1 + hs % 5];
    tp := (array[0, 1, 1, 1, 2])[1 + (hs / 5) % 5];
    wd := (array[0, 1, 1, 1, 2])[1 + (hs / 25) % 5];
  end if;
  for i in 1..coalesce(cardinality(p_lineup), 0) loop
    select rp.id, rp.grp, rp.ovr, rp.sho, rp.phy, rp.pac, rp.dri, rp.pas, rp.dfn, coalesce(q.ovr_delta, 0) dl, coalesce(q.fitness, 100) fit, coalesce(q.form, 6.5) frm, coalesce(q.morale, 70) mo
      into p from public.real_players rp left join public.squads q on q.player_id = rp.id and q.team_id = p_team
     where rp.id = p_lineup[i];
    f := (0.75 + 0.25 * p.fit / 100.0) * (1 + (p.frm - 6.5) * 0.02) * (1 + (p.mo - 70) * 0.0006);
    base := p.ovr + p.dl;
    eff := (case when p.grp = slots[i] then base when slots[i] = 'GK' or p.grp = 'GK' then base * 0.5 else base * 0.85 end) * f;
    case slots[i]
      when 'GK' then gk := eff; gkid := p.id;
      when 'DEF' then d := d + eff; nd := nd + 1;
      when 'MID' then m := m + eff; nm := nm + 1;
      else fw := fw + eff; nf := nf + 1;
    end case;
    -- kanat: 4+ kişilik hattın uçları, ya da ileri hatlardaki 3'lü hattın uçları
    wide := i > 1 and i <= cardinality(lineof) and (posin[i] = 1 or posin[i] = linecnt[i])
            and (linecnt[i] >= 4 or (linecnt[i] = 3 and lineof[i] >= 3));
    if slots[i] <> 'GK' and p.grp <> 'GK' then
      if wide then wing := wing + (p.pac * 0.45 + p.dri * 0.3 + p.pas * 0.25) * f; nwing := nwing + 1; end if;
      if slots[i] = 'FWD' then air := greatest(air, (p.phy * 0.6 + base * 0.4) * f); pace := pace + p.pac * f; npace := npace + 1; end if;
      if slots[i] = 'DEF' then
        dpace := dpace + p.pac; ndp := ndp + 1;
        if wide then fbdef := fbdef + (p.dfn * 0.6 + p.pac * 0.4) * f; nfb := nfb + 1; else cbair := cbair + (p.phy * 0.5 + p.dfn * 0.5) * f; ncb := ncb + 1; end if;
      end if;
      if slots[i] = 'MID' then midtech := midtech + (p.pas * 0.6 + p.dri * 0.4) * f; nmt := nmt + 1; lsh := lsh + p.sho * f; nls := nls + 1; end if;
    end if;
    if slots[i] <> 'GK' then
      shooters := shooters || jsonb_build_object('id', p.id, 'g', slots[i], 'pac', p.pac, 'phy', p.phy, 'sho', p.sho, 'w',
        (case slots[i] when 'FWD' then 3.0 when 'MID' then 1.3 else 0.35 end) * (case when p.sho > 0 then p.sho else p.ovr end) / 70.0,
        'q', ((case when p.sho > 0 then (p.sho + p.ovr) / 2.0 else p.ovr end) + p.dl) * f);
    end if;
    players := players || jsonb_build_object('id', p.id, 'g', slots[i], 'e', round(eff, 1), 'phy', p.phy, 'fit', p.fit);
  end loop;
  return jsonb_build_object(
    'def', (case when nd > 0 then d / nd else 40 end) * (0.94 + 0.02 * least(nd, 5)) * (1 - mt * 0.03)
             * (1 - (pr - 1) * 0.025) * (1 - (wd - 1) * 0.01),
    'mid', (case when nm > 0 then m / nm else 40 end) * (0.9 + 0.033 * least(nm, 6)) * (1 + (pr - 1) * 0.03) * (1 - (tp - 1) * 0.02),
    'att', (case when nf > 0 then fw / nf else 40 end) * (0.92 + 0.04 * least(nf, 3)) * (1 + mt * 0.04)
             * (1 + (tp - 1) * 0.03) * (1 + (wd - 1) * 0.015),
    'gk', gk, 'gkid', gkid, 'lineup', to_jsonb(p_lineup), 'formation', t.formation, 'shooters', shooters, 'players', players,
    'press', pr, 'tempo', tp, 'width', wd, 'ment', mt,
    'wing', round(case when nwing > 0 then wing / nwing else 62 end, 1), 'air', round(case when air > 0 then air else 62 end, 1),
    'pace', round(case when npace > 0 then pace / npace else 65 end, 1), 'fbdef', round(case when nfb > 0 then fbdef / nfb else 62 end, 1),
    'cbair', round(case when ncb > 0 then cbair / ncb else 65 end, 1), 'dpace', round(case when ndp > 0 then dpace / ndp else 65 end, 1),
    'midtech', round(case when nmt > 0 then midtech / nmt else 65 end, 1), 'lsh', round(case when nls > 0 then lsh / nls else 60 end, 1));
end $$;

-- yapay zekanın maç öncesi taktiği: kimliğinden gelen tarz + rakibe göre uyarlama
create or replace function public._ai_tactic(p_team uuid, p_opp uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t record; hs int; pr int; tp int; wd int; mt int := 0; r numeric; pw jsonb;
begin
  select * into t from public.teams where id = p_team;
  select sum(ascii(substr(t.id::text, g, 1)) * g) into hs from generate_series(1, 36) g;
  pr := (array[0, 1, 1, 1, 2])[1 + hs % 5];
  tp := (array[0, 1, 1, 1, 2])[1 + (hs / 5) % 5];
  wd := (array[0, 1, 1, 1, 2])[1 + (hs / 25) % 5];
  r := public._euro_power(p_team) / greatest(1, public._euro_power(p_opp));
  if r < 0.95 then pr := 0; tp := 2; mt := -1;          -- güçlü rakip: geride bekle, kontra
  elsif r > 1.05 then pr := 2; mt := 1; tp := greatest(tp, 1); -- zayıf rakip: önde bas, hücum
  end if;
  pw := public._power2(p_team, public._fix_lineup(p_team), jsonb_build_object('press', pr, 'tempo', tp, 'width', wd, 'ment', mt));
  if (pw->>'wing')::numeric >= 74 then wd := 2; elsif (pw->>'wing')::numeric < 64 then wd := 0; end if; -- iyi kanatçı: kanat oyunu
  return jsonb_build_object('press', pr, 'tempo', tp, 'width', wd, 'ment', mt);
end $$;

-- menajer takımının taktiği (takım kaydından)
create or replace function public._team_tactic(p_team uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('press', coalesce((t.instr->>'press')::int, 1), 'tempo', coalesce((t.instr->>'tempo')::int, 1),
    'width', coalesce((t.instr->>'width')::int, 1), 'ment', t.mentality) from public.teams t where t.id = p_team $$;
