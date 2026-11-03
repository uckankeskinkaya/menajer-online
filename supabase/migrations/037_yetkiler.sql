-- MENAJER ONLINE 037: yönetim, taktik ve maç içi müdahale fonksiyonlarının yetkileri. SQL Editor'den çalıştır.
revoke execute on function public._board_target(uuid, uuid) from public, anon, authenticated;
revoke execute on function public._job_pool(uuid, uuid, boolean, int) from public, anon, authenticated;
revoke execute on function public._board_update(uuid, int, boolean) from public, anon, authenticated;
revoke execute on function public._sack(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public._power2(uuid, int[], jsonb) from public, anon, authenticated;
revoke execute on function public._ai_tactic(uuid, uuid) from public, anon, authenticated;
revoke execute on function public._team_tactic(uuid) from public, anon, authenticated;
revoke execute on function public._sim_run(bigint, int) from public, anon, authenticated;
revoke execute on function public.take_job(uuid, uuid) from public, anon;
revoke execute on function public.match_change(uuid, int, int, int[], int, int, int) from public, anon;
revoke execute on function public.finish_match(uuid) from public, anon;
grant execute on function public.take_job(uuid, uuid), public.match_change(uuid, int, int, int[], int, int, int), public.finish_match(uuid) to authenticated;
