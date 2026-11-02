-- MENAJER ONLINE 009: günlük dinlenme %15 -> %20 (rotasyon yapmayan takım bir sezonda %35'e düşüyordu)
do $$
declare d text;
begin
  d := pg_get_functiondef('public._after_round(uuid,int)'::regprocedure);
  if position('fitness = least(100, fitness + 15)' in d) = 0 then raise exception '_after_round beklenen haliyle değil'; end if;
  execute replace(d, 'fitness = least(100, fitness + 15)', 'fitness = least(100, fitness + 20)');
end $$;

-- dinlenme artınca oyuncular daha dinç: 540 maçta 2.94 gol. İsabetli şutun gol sabiti 0.33 -> 0.29
do $$
declare d text;
begin
  d := pg_get_functiondef('public._sim_fixture(bigint)'::regprocedure);
  if position('gp := 0.33 *' in d) = 0 then raise exception '_sim_fixture beklenen haliyle değil'; end if;
  execute replace(d, 'gp := 0.33 *', 'gp := 0.29 *');
end $$;
