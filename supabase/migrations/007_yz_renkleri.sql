-- MENAJER ONLINE 007: yapay zeka takımı renk paletinden çimle karışan yeşil çıkarıldı (#2e7d32 -> #212121)
do $$
declare d text;
begin
  d := pg_get_functiondef('public.start_game(uuid)'::regprocedure);
  if position('''#2e7d32''' in d) = 0 then raise exception 'start_game beklenen haliyle değil'; end if;
  execute replace(d, '''#2e7d32''', '''#212121''');
end $$;
update public.teams set color1 = '#212121' where is_bot and color1 = '#2e7d32';
