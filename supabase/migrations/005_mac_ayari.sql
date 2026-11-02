-- MENAJER ONLINE: maç motoru ayarı
-- 207 maçlık test: gol ortalaması 2.97 (hedef ~2.5). İsabetli şutun gol olma sabiti 0.30 -> 0.25.
do $$
declare d text;
begin
  d := pg_get_functiondef('public._sim_fixture(bigint)'::regprocedure);
  if position('gp := 0.30 *' in d) = 0 then raise exception '_sim_fixture beklenen haliyle değil'; end if;
  execute replace(d, 'gp := 0.30 *', 'gp := 0.25 *');
end $$;

-- 224 maçlık ikinci test: 2.84 gol, 23.9 şut/maç. 0.19 ile denendi: 2.20 gol (336 maç).
-- Şut sıklığı sabiti 0.22 -> 0.21.
do $$
declare d text;
begin
  d := pg_get_functiondef('public._sim_fixture(bigint)'::regprocedure);
  if position('shp := 0.22 *' in d) = 0 then raise exception '_sim_fixture beklenen haliyle değil'; end if;
  execute replace(d, 'shp := 0.22 *', 'shp := 0.21 *');
end $$;
