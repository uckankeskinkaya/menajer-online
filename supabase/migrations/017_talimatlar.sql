-- MENAJER ONLINE 017: takım talimatları (pres / tempo / genişlik). SQL Editor'den çalıştır.
alter table public.teams add column if not exists instr jsonb not null default '{}'::jsonb;
create index if not exists offers_player_id_idx on public.offers (player_id);  -- get_advisors: indekssiz yabancı anahtar

create or replace function public.set_instr(p_game uuid, p_press int, p_tempo int, p_width int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); tid uuid;
begin
  if uid is null then return jsonb_build_object('ok', false, 'msg', 'Giriş yapmalısın'); end if;
  if p_press is null or p_tempo is null or p_width is null
     or p_press not between 0 and 2 or p_tempo not between 0 and 2 or p_width not between 0 and 2 then
    return jsonb_build_object('ok', false, 'msg', 'Geçersiz talimat');
  end if;
  select id into tid from public.teams where game_id = p_game and owner = uid;
  if tid is null then return jsonb_build_object('ok', false, 'msg', 'Bu odada takımın yok'); end if;
  update public.teams set instr = jsonb_build_object('press', p_press, 'tempo', p_tempo, 'width', p_width) where id = tid;
  return jsonb_build_object('ok', true, 'msg', 'Talimatlar kaydedildi');
end $$;

revoke execute on function public.set_instr(uuid, int, int, int) from public, anon;
grant execute on function public.set_instr(uuid, int, int, int) to authenticated;
