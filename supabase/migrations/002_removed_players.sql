-- A removed (INACTIVE) player no longer blocks the same name from registering again.
drop index if exists public.players_group_name_uq;
create unique index players_group_name_uq on public.players (group_id, lower(name)) where status <> 'INACTIVE';

create or replace function public.register_player(p_slug text, p_name text, p_phone text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare g_id uuid; pid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if length(trim(p_name)) < 2 then raise exception 'name too short'; end if;
  select id into g_id from groups where slug = p_slug;
  if g_id is null then raise exception 'group not found'; end if;
  if exists (select 1 from players where group_id = g_id and lower(name) = lower(trim(p_name)) and status <> 'INACTIVE') then
    raise exception 'that name is already registered, pick it from the list or use a different name';
  end if;
  insert into players (group_id, name, tier, status) values (g_id, trim(p_name), 'DROP_IN', 'PENDING')
  returning id into pid;
  if p_phone is not null and length(trim(p_phone)) > 0 then
    insert into player_private (player_id, phone) values (pid, trim(p_phone));
  end if;
  insert into player_devices (user_id, player_id) values (auth.uid(), pid)
  on conflict (user_id) do update set player_id = excluded.player_id;
  return pid;
end $$;

-- Permanently deletes removed players. Anyone with a payment or a charged game is kept so the pool and dues stay correct.
create or replace function public.admin_purge_removed_players(p_group_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not is_group_admin(p_group_id) then raise exception 'not authorized'; end if;
  with gone as (
    delete from players p
     where p.group_id = p_group_id and p.status = 'INACTIVE'
       and not exists (select 1 from ledger_payments l where l.player_id = p.id)
       and not exists (select 1 from attendance_votes v where v.player_id = p.id and v.fee_applied > 0)
    returning 1)
  select count(*) into n from gone;
  return n;
end $$;

revoke all on function public.admin_purge_removed_players(uuid) from public;
grant execute on function public.admin_purge_removed_players(uuid) to authenticated;
