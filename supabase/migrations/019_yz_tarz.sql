-- MENAJER ONLINE 019: yapay zeka takımlarına kalıcı oyun tarzı (pres/tempo/genişlik, takım kimliğinden; istemcide teamStyle aynı hesabı yapar).
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
    select rp.id, rp.grp, rp.ovr, rp.sho, rp.phy, coalesce(q.ovr_delta, 0) dl, coalesce(q.fitness, 100) fit, coalesce(q.form, 6.5) frm
      into p from public.real_players rp left join public.squads q on q.player_id = rp.id and q.team_id = p_team
     where rp.id = p_lineup[i];
    f := (0.75 + 0.25 * p.fit / 100.0) * (1 + (p.frm - 6.5) * 0.02);
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
