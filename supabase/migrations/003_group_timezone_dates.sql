-- Use the group's time zone (not UTC current_date) for membership payment dates, so "today"
-- matches the session date logic around midnight.

create or replace function public.record_membership_payment(
  p_player_id uuid, p_amount numeric, p_period_start date, p_period_end date, p_paid_on date default null, p_notes text default null)
returns void language plpgsql security definer set search_path = public as $$
declare pl players;
begin
  select * into pl from players where id = p_player_id;
  if not found or not is_group_admin(pl.group_id) then raise exception 'not authorized'; end if;
  insert into ledger_payments (group_id, player_id, payment_type, amount, period_start, period_end, paid_on, notes)
  values (pl.group_id, p_player_id, 'MEMBERSHIP', p_amount, p_period_start, p_period_end,
          coalesce(p_paid_on, group_today(pl.group_id)), p_notes);
  update players set tier = 'MEMBER',
    membership_valid_until = greatest(coalesce(membership_valid_until, p_period_end), p_period_end)
  where id = p_player_id;
end $$;
