-- MENAJER ONLINE 029: antrenman kolonları + yetkiler. SQL Editor'den çalıştır.
alter table public.teams add column if not exists training jsonb not null default '{}'::jsonb;
alter table public.squads add column if not exists xp int not null default 0;
revoke execute on function public._train_week(uuid) from public, anon, authenticated;
revoke execute on function public.set_training(uuid, text, int) from public, anon;
grant execute on function public.set_training(uuid, text, int) to authenticated;
