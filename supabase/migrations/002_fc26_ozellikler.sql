-- FC 26 verisi: ek özellikler + tek seferlik içe aktarma fonksiyonu
alter table public.real_players
  add column full_name text not null default '',
  add column pac int not null default 0, add column sho int not null default 0,
  add column pas int not null default 0, add column dri int not null default 0,
  add column dfn int not null default 0, add column phy int not null default 0;
comment on column public.real_players.pac is 'kalecilerde: diving; sho=handling, pas=kicking, dri=reflexes, dfn=positioning, phy=speed';

-- tools/build_players.py çıktısını yükler. Squads'ta kullanılan oyuncular silinmez.
-- Kullanımdan sonra anon yetkisini kendisi kaldırır (tek seferlik).
create or replace function public.tmp_import_players(data jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  delete from public.real_players p
   where not exists (select 1 from jsonb_array_elements(data) x where (x->>'id')::int = p.id)
     and not exists (select 1 from public.squads s where s.player_id = p.id);
  insert into public.real_players (id,name,full_name,positions,grp,ovr,pot,age,nat,club,lg,val,pac,sho,pas,dri,dfn,phy)
  select (x->>'id')::int, x->>'name', x->>'full_name', x->>'positions', x->>'grp', (x->>'ovr')::int, (x->>'pot')::int,
         (x->>'age')::int, x->>'nat', x->>'club', x->>'lg', (x->>'val')::bigint,
         (x->>'pac')::int, (x->>'sho')::int, (x->>'pas')::int, (x->>'dri')::int, (x->>'dfn')::int, (x->>'phy')::int
  from jsonb_array_elements(data) x
  on conflict (id) do update set name=excluded.name, full_name=excluded.full_name, positions=excluded.positions,
    grp=excluded.grp, ovr=excluded.ovr, pot=excluded.pot, age=excluded.age, nat=excluded.nat, club=excluded.club,
    lg=excluded.lg, val=excluded.val, pac=excluded.pac, sho=excluded.sho, pas=excluded.pas, dri=excluded.dri,
    dfn=excluded.dfn, phy=excluded.phy;
  get diagnostics n = row_count;
  execute 'revoke execute on function public.tmp_import_players(jsonb) from anon, authenticated, public';
  return n;
end $$;
revoke execute on function public.tmp_import_players(jsonb) from public, authenticated;
grant execute on function public.tmp_import_players(jsonb) to anon;
