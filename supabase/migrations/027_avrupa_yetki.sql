-- MENAJER ONLINE 027: Avrupa kupası tablo değişiklikleri + yetkiler. SQL Editor'den çalıştır.
alter table public.teams add column if not exists guest boolean not null default false;
alter table public.games add column if not exists euro jsonb;
alter table public.fixtures drop constraint if exists fixtures_comp_check;
alter table public.fixtures add constraint fixtures_comp_check check (comp in ('league', 'cup', 'friendly', 'euro'));
revoke execute on function public._euro_power(uuid) from public, anon, authenticated;
revoke execute on function public._team_lg(uuid) from public, anon, authenticated;
revoke execute on function public._euro_slots(text) from public, anon, authenticated;
revoke execute on function public._euro_prize(uuid, bigint, text) from public, anon, authenticated;
revoke execute on function public._gen_euro(uuid, int) from public, anon, authenticated;
revoke execute on function public._euro_tie(uuid, int, int, uuid, uuid, int, int) from public, anon, authenticated;
revoke execute on function public._resolve_euro(uuid) from public, anon, authenticated;
revoke execute on function public.euro_table(uuid) from public, anon;
grant execute on function public.euro_table(uuid) to authenticated;
