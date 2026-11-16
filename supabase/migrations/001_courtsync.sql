-- CourtSync schema. Run in the Supabase SQL editor.
-- Prereq: Authentication > Providers > enable "Anonymous Sign-Ins".

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- tables

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  players_per_court int not null default 7 check (players_per_court > 0),
  max_courts int not null default 3 check (max_courts > 0),
  base_court_cost numeric(10,2) not null default 800,
  extra_court_default_cost numeric(10,2) not null default 800,
  extra_court_cost_mode text not null default 'POOL' check (extra_court_cost_mode in ('POOL','SPLIT')),
  membership_fee numeric(10,2) not null default 1500,
  daily_dropin_fee numeric(10,2) not null default 150,
  cutoff_time time,
  play_days int[] not null default '{1,2,3,4,5,6,7}', -- ISO: 1=Mon .. 7=Sun
  venue text,
  play_time text,
  upi_id text,
  timezone text not null default 'Asia/Kolkata',
  created_at timestamptz not null default now()
);

create table public.group_secrets (
  group_id uuid primary key references public.groups(id) on delete cascade,
  admin_pin_hash text not null
);

create table public.group_admins (
  user_id uuid not null,
  group_id uuid not null references public.groups(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, group_id)
);

create table public.admin_attempts (
  id bigint generated always as identity primary key,
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid,
  success boolean not null,
  attempted_at timestamptz not null default now()
);

create table public.players (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  name text not null,
  tier text not null default 'DROP_IN' check (tier in ('MEMBER','DROP_IN')),
  membership_valid_until date,
  status text not null default 'PENDING' check (status in ('ACTIVE','PENDING','INACTIVE')),
  created_at timestamptz not null default now()
);
create unique index players_group_name_uq on public.players (group_id, lower(name));

create table public.player_private (
  player_id uuid primary key references public.players(id) on delete cascade,
  phone text
);

create table public.player_devices (
  user_id uuid primary key,
  player_id uuid not null references public.players(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  session_date date not null,
  status text not null default 'OPEN' check (status in ('OPEN','LOCKED','COMPLETED','CANCELLED')),
  courts_booked int not null default 1,
  notes text,
  created_at timestamptz not null default now(),
  unique (group_id, session_date)
);

create table public.attendance_votes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  vote_status text not null check (vote_status in ('IN','OUT')),
  fee_applied numeric(10,2) not null default 0,
  added_by_admin boolean not null default false,
  voted_at timestamptz not null default now(),
  unique (session_id, player_id)
);

-- Expense ledger: court fees, shuttles, equipment, anything paid out of the pool.
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  session_id uuid references public.sessions(id) on delete set null,
  expense_date date not null,
  category text not null check (category in ('COURT_FEE','SHUTTLES','EQUIPMENT','OTHER')),
  description text,
  amount numeric(10,2) not null check (amount >= 0),
  source text not null default 'MANUAL' check (source in ('MANUAL','AUTO')),
  notes text,
  created_at timestamptz not null default now()
);
create index expenses_group_date_idx on public.expenses (group_id, expense_date);

-- Income / settlements.
create table public.ledger_payments (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  payment_type text not null check (payment_type in ('MEMBERSHIP','SETTLEMENT')),
  amount numeric(10,2) not null check (amount > 0),
  period_start date,
  period_end date,
  paid_on date not null default current_date,
  notes text,
  created_at timestamptz not null default now()
);
create index ledger_group_paid_idx on public.ledger_payments (group_id, paid_on);

-- ---------------------------------------------------------------- helpers

create or replace function public.is_group_admin(p_group_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from group_admins where user_id = auth.uid() and group_id = p_group_id);
$$;

create or replace function public.my_player_id()
returns uuid language sql stable security definer set search_path = public as $$
  select player_id from player_devices where user_id = auth.uid();
$$;

-- ---------------------------------------------------------------- RLS

alter table public.groups enable row level security;
alter table public.group_secrets enable row level security;
alter table public.group_admins enable row level security;
alter table public.admin_attempts enable row level security;
alter table public.players enable row level security;
alter table public.player_private enable row level security;
alter table public.player_devices enable row level security;
alter table public.sessions enable row level security;
alter table public.attendance_votes enable row level security;
alter table public.expenses enable row level security;
alter table public.ledger_payments enable row level security;

-- group_secrets and admin_attempts: no policies => unreachable from the client.

create policy groups_read on public.groups for select to authenticated using (true);
create policy groups_admin_update on public.groups for update to authenticated
  using (public.is_group_admin(id)) with check (public.is_group_admin(id));

create policy group_admins_self on public.group_admins for select to authenticated
  using (user_id = auth.uid());

create policy players_read on public.players for select to authenticated using (true);
create policy players_admin_write on public.players for all to authenticated
  using (public.is_group_admin(group_id)) with check (public.is_group_admin(group_id));

create policy player_private_admin on public.player_private for all to authenticated
  using (exists (select 1 from public.players p where p.id = player_id and public.is_group_admin(p.group_id)))
  with check (exists (select 1 from public.players p where p.id = player_id and public.is_group_admin(p.group_id)));

create policy player_devices_self on public.player_devices for select to authenticated
  using (user_id = auth.uid());

create policy sessions_read on public.sessions for select to authenticated using (true);
create policy sessions_admin_write on public.sessions for all to authenticated
  using (public.is_group_admin(group_id)) with check (public.is_group_admin(group_id));

create policy votes_read on public.attendance_votes for select to authenticated using (true);
create policy votes_admin_write on public.attendance_votes for all to authenticated
  using (exists (select 1 from public.sessions s where s.id = session_id and public.is_group_admin(s.group_id)))
  with check (exists (select 1 from public.sessions s where s.id = session_id and public.is_group_admin(s.group_id)));

create policy expenses_admin on public.expenses for all to authenticated
  using (public.is_group_admin(group_id)) with check (public.is_group_admin(group_id));

create policy ledger_admin on public.ledger_payments for all to authenticated
  using (public.is_group_admin(group_id)) with check (public.is_group_admin(group_id));
create policy ledger_own_read on public.ledger_payments for select to authenticated
  using (player_id = public.my_player_id());

-- ---------------------------------------------------------------- RPCs

-- Today's date in the group's time zone.
create or replace function public.group_today(p_group_id uuid)
returns date language sql stable security definer set search_path = public as $$
  select (now() at time zone timezone)::date from groups where id = p_group_id;
$$;

create or replace function public.admin_login(p_slug text, p_pin text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare g_id uuid; h text; fails int; ok boolean;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select id into g_id from groups where slug = p_slug;
  if g_id is null then return false; end if;

  select count(*) into fails from admin_attempts
   where group_id = g_id and success = false and attempted_at > now() - interval '15 minutes';
  if fails >= 10 then raise exception 'too many attempts, try again later'; end if;

  select admin_pin_hash into h from group_secrets where group_id = g_id;
  ok := h is not null and crypt(p_pin, h) = h;
  insert into admin_attempts (group_id, user_id, success) values (g_id, auth.uid(), ok);
  if ok then
    insert into group_admins (user_id, group_id) values (auth.uid(), g_id) on conflict do nothing;
  end if;
  return ok;
end $$;

create or replace function public.set_admin_pin(p_group_id uuid, p_new_pin text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not is_group_admin(p_group_id) then raise exception 'not authorized'; end if;
  if length(p_new_pin) < 4 then raise exception 'PIN must be at least 4 characters'; end if;
  update group_secrets set admin_pin_hash = crypt(p_new_pin, gen_salt('bf')) where group_id = p_group_id;
end $$;

create or replace function public.claim_player(p_player_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare p players;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into p from players where id = p_player_id;
  if not found or p.status = 'INACTIVE' then raise exception 'player not available'; end if;
  insert into player_devices (user_id, player_id) values (auth.uid(), p_player_id)
  on conflict (user_id) do update set player_id = excluded.player_id;
end $$;

create or replace function public.register_player(p_slug text, p_name text, p_phone text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare g_id uuid; pid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if length(trim(p_name)) < 2 then raise exception 'name too short'; end if;
  select id into g_id from groups where slug = p_slug;
  if g_id is null then raise exception 'group not found'; end if;
  insert into players (group_id, name, tier, status) values (g_id, trim(p_name), 'DROP_IN', 'PENDING')
  returning id into pid;
  if p_phone is not null and length(trim(p_phone)) > 0 then
    insert into player_private (player_id, phone) values (pid, trim(p_phone));
  end if;
  insert into player_devices (user_id, player_id) values (auth.uid(), pid)
  on conflict (user_id) do update set player_id = excluded.player_id;
  return pid;
end $$;

create or replace function public.get_or_create_today_session(p_slug text)
returns public.sessions language plpgsql security definer set search_path = public as $$
declare g groups; d date; s sessions;
begin
  select * into g from groups where slug = p_slug;
  if not found then raise exception 'group not found'; end if;
  d := (now() at time zone g.timezone)::date;
  select * into s from sessions where group_id = g.id and session_date = d;
  if found then return s; end if;
  if not (extract(isodow from d)::int = any (g.play_days)) then
    raise exception 'no session today';
  end if;
  insert into sessions (group_id, session_date) values (g.id, d)
  on conflict (group_id, session_date) do nothing;
  select * into s from sessions where group_id = g.id and session_date = d;
  return s;
end $$;

create or replace function public.admin_create_session(p_group_id uuid, p_date date)
returns public.sessions language plpgsql security definer set search_path = public as $$
declare s sessions;
begin
  if not is_group_admin(p_group_id) then raise exception 'not authorized'; end if;
  insert into sessions (group_id, session_date) values (p_group_id, p_date)
  on conflict (group_id, session_date) do nothing;
  select * into s from sessions where group_id = p_group_id and session_date = p_date;
  return s;
end $$;

create or replace function public.cast_vote(p_session_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare s sessions; g groups; me uuid; pl players; local_now timestamp;
begin
  if p_status not in ('IN','OUT') then raise exception 'invalid status'; end if;
  me := my_player_id();
  if me is null then raise exception 'choose your name first'; end if;
  select * into s from sessions where id = p_session_id;
  if not found then raise exception 'session not found'; end if;
  select * into g from groups where id = s.group_id;
  select * into pl from players where id = me;
  if pl.group_id <> s.group_id or pl.status <> 'ACTIVE' then
    raise exception 'your registration is pending admin approval';
  end if;
  if s.status <> 'OPEN' then raise exception 'voting is closed'; end if;

  local_now := now() at time zone g.timezone;
  if p_status = 'IN' and g.cutoff_time is not null
     and s.session_date = local_now::date and local_now::time > g.cutoff_time then
    raise exception 'cutoff time has passed';
  end if;

  insert into attendance_votes (session_id, player_id, vote_status)
  values (p_session_id, me, p_status)
  on conflict (session_id, player_id) do update
    set vote_status = excluded.vote_status, voted_at = now()
    where attendance_votes.vote_status <> excluded.vote_status;
end $$;

create or replace function public.admin_set_vote(p_session_id uuid, p_player_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare s sessions;
begin
  select * into s from sessions where id = p_session_id;
  if not found or not is_group_admin(s.group_id) then raise exception 'not authorized'; end if;
  if p_status not in ('IN','OUT') then raise exception 'invalid status'; end if;
  insert into attendance_votes (session_id, player_id, vote_status, added_by_admin)
  values (p_session_id, p_player_id, p_status, true)
  on conflict (session_id, player_id) do update
    set vote_status = excluded.vote_status, added_by_admin = true, voted_at = now()
    where attendance_votes.vote_status <> excluded.vote_status;
end $$;

-- Finalise a day: books courts, writes court-fee expenses and charges each player.
-- Players are ranked by vote time; ranks beyond max_courts*players_per_court are waitlisted and not charged.
-- Those who play are split evenly across the courts (9 over 2 -> 5 + 4) with active members placed first,
-- so members stay together in Court 1. Under SPLIT mode, only players outside Court 1 share the extra-court cost.
create or replace function public.complete_session(
  p_session_id uuid, p_courts_booked int default null, p_extra_court_cost numeric default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  s sessions; g groups; cap int; in_count int; played int; courts int;
  extra_cost numeric; extra_players int; extra_total numeric; i int;
  base int; rem int; size1 int;
begin
  select * into s from sessions where id = p_session_id;
  if not found then raise exception 'session not found'; end if;
  if not is_group_admin(s.group_id) then raise exception 'not authorized'; end if;
  select * into g from groups where id = s.group_id;

  cap := g.max_courts * g.players_per_court;
  select count(*) into in_count from attendance_votes where session_id = s.id and vote_status = 'IN';
  played := least(in_count, cap);
  courts := coalesce(p_courts_booked, greatest(1, ceil(played::numeric / g.players_per_court)::int));
  courts := least(greatest(courts, 1), g.max_courts);
  extra_cost := coalesce(p_extra_court_cost, g.extra_court_default_cost);
  base := played / courts;
  rem := played % courts;
  size1 := base + (case when rem > 0 then 1 else 0 end);
  extra_players := played - size1;
  extra_total := extra_cost * (courts - 1);

  delete from expenses where session_id = s.id and source = 'AUTO';
  insert into expenses (group_id, session_id, expense_date, category, description, amount, source)
  values (g.id, s.id, s.session_date, 'COURT_FEE', 'Court 1', g.base_court_cost, 'AUTO');
  for i in 2..courts loop
    insert into expenses (group_id, session_id, expense_date, category, description, amount, source)
    values (g.id, s.id, s.session_date, 'COURT_FEE', 'Court ' || i, extra_cost, 'AUTO');
  end loop;

  with ranked as (
    select v.id, v.player_id, row_number() over (order by v.voted_at, v.id) as rn
      from attendance_votes v where v.session_id = s.id and v.vote_status = 'IN'),
  flagged as (
    select r.*, (p.tier = 'MEMBER' and p.membership_valid_until is not null
                 and p.membership_valid_until >= s.session_date) as is_member
      from ranked r join players p on p.id = r.player_id),
  placed as (
    select f.*, case when f.rn <= cap
           then row_number() over (partition by (f.rn <= cap) order by (not f.is_member), f.rn) end as pos
      from flagged f),
  courted as (
    select pl.*, case
             when pl.pos is null then null
             when pl.pos <= rem * (base + 1) then ceil(pl.pos::numeric / (base + 1))::int
             else rem + ceil((pl.pos - rem * (base + 1))::numeric / base)::int end as court_no
      from placed pl)
  update attendance_votes av set fee_applied =
    case when c.rn > cap then 0 else
      (case when c.is_member then 0 else g.daily_dropin_fee end)
      + (case when g.extra_court_cost_mode = 'SPLIT' and c.court_no > 1
                   and extra_players > 0 and courts > 1
              then round(extra_total / extra_players, 2) else 0 end)
    end
  from courted c
  where av.id = c.id;

  update attendance_votes set fee_applied = 0 where session_id = s.id and vote_status <> 'IN';
  update sessions set status = 'COMPLETED', courts_booked = courts where id = s.id;
end $$;

create or replace function public.record_membership_payment(
  p_player_id uuid, p_amount numeric, p_period_start date, p_period_end date, p_paid_on date default null, p_notes text default null)
returns void language plpgsql security definer set search_path = public as $$
declare pl players;
begin
  select * into pl from players where id = p_player_id;
  if not found or not is_group_admin(pl.group_id) then raise exception 'not authorized'; end if;
  insert into ledger_payments (group_id, player_id, payment_type, amount, period_start, period_end, paid_on, notes)
  values (pl.group_id, p_player_id, 'MEMBERSHIP', p_amount, p_period_start, p_period_end,
          coalesce(p_paid_on, current_date), p_notes);
  update players set tier = 'MEMBER',
    membership_valid_until = greatest(coalesce(membership_valid_until, p_period_end), p_period_end)
  where id = p_player_id;
end $$;

-- Per-player dues: accrued charges minus settlements.
create or replace function public.player_balances(p_group_id uuid)
returns table (player_id uuid, accrued numeric, settled numeric, balance numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_group_admin(p_group_id) then raise exception 'not authorized'; end if;
  return query
  select p.id,
         coalesce((select sum(v.fee_applied) from attendance_votes v join sessions s on s.id = v.session_id
                    where v.player_id = p.id and s.status = 'COMPLETED'), 0),
         coalesce((select sum(l.amount) from ledger_payments l
                    where l.player_id = p.id and l.payment_type = 'SETTLEMENT'), 0),
         coalesce((select sum(v.fee_applied) from attendance_votes v join sessions s on s.id = v.session_id
                    where v.player_id = p.id and s.status = 'COMPLETED'), 0)
         - coalesce((select sum(l.amount) from ledger_payments l
                    where l.player_id = p.id and l.payment_type = 'SETTLEMENT'), 0)
    from players p where p.group_id = p_group_id;
end $$;

create or replace function public.my_balance()
returns table (accrued numeric, settled numeric, balance numeric)
language sql stable security definer set search_path = public as $$
  select a.accrued, b.settled, a.accrued - b.settled from
   (select coalesce(sum(v.fee_applied), 0) as accrued from attendance_votes v join sessions s on s.id = v.session_id
     where v.player_id = my_player_id() and s.status = 'COMPLETED') a,
   (select coalesce(sum(l.amount), 0) as settled from ledger_payments l
     where l.player_id = my_player_id() and l.payment_type = 'SETTLEMENT') b;
$$;

-- Pool summary for a date range (inclusive).
create or replace function public.pool_summary(p_group_id uuid, p_from date, p_to date)
returns json language plpgsql stable security definer set search_path = public as $$
declare mem numeric; setl numeric; exp_total numeric; by_cat json;
begin
  if not is_group_admin(p_group_id) then raise exception 'not authorized'; end if;
  select coalesce(sum(amount), 0) into mem from ledger_payments
   where group_id = p_group_id and payment_type = 'MEMBERSHIP' and paid_on between p_from and p_to;
  select coalesce(sum(amount), 0) into setl from ledger_payments
   where group_id = p_group_id and payment_type = 'SETTLEMENT' and paid_on between p_from and p_to;
  select coalesce(sum(amount), 0) into exp_total from expenses
   where group_id = p_group_id and expense_date between p_from and p_to;
  select coalesce(json_object_agg(category, total), '{}'::json) into by_cat from
   (select category, sum(amount) as total from expenses
     where group_id = p_group_id and expense_date between p_from and p_to group by category) t;
  return json_build_object('memberships', mem, 'dropins', setl, 'expenses', exp_total,
                           'expensesByCategory', by_cat, 'net', mem + setl - exp_total);
end $$;

-- Public (anon) summary used by the Netlify OG-preview function.
create or replace function public.public_today_summary(p_slug text)
returns json language plpgsql stable security definer set search_path = public as $$
declare g groups; d date; n int; cap int;
begin
  select * into g from groups where slug = p_slug;
  if not found then return null; end if;
  d := (now() at time zone g.timezone)::date;
  select count(*) into n from attendance_votes v join sessions s on s.id = v.session_id
   where s.group_id = g.id and s.session_date = d and v.vote_status = 'IN';
  cap := g.max_courts * g.players_per_court;
  return json_build_object('name', g.name, 'date', d, 'playersIn', least(n, cap),
    'courts', greatest(1, ceil(least(n, cap)::numeric / g.players_per_court)::int),
    'playersPerCourt', g.players_per_court);
end $$;

-- ---------------------------------------------------------------- grants

revoke all on function public.admin_login(text, text) from public;
revoke all on function public.set_admin_pin(uuid, text) from public;
revoke all on function public.claim_player(uuid) from public;
revoke all on function public.register_player(text, text, text) from public;
revoke all on function public.get_or_create_today_session(text) from public;
revoke all on function public.admin_create_session(uuid, date) from public;
revoke all on function public.cast_vote(uuid, text) from public;
revoke all on function public.admin_set_vote(uuid, uuid, text) from public;
revoke all on function public.complete_session(uuid, int, numeric) from public;
revoke all on function public.record_membership_payment(uuid, numeric, date, date, date, text) from public;
revoke all on function public.player_balances(uuid) from public;
revoke all on function public.my_balance() from public;
revoke all on function public.pool_summary(uuid, date, date) from public;
revoke all on function public.public_today_summary(text) from public;

grant execute on function public.admin_login(text, text) to authenticated;
grant execute on function public.set_admin_pin(uuid, text) to authenticated;
grant execute on function public.claim_player(uuid) to authenticated;
grant execute on function public.register_player(text, text, text) to authenticated;
grant execute on function public.get_or_create_today_session(text) to authenticated;
grant execute on function public.admin_create_session(uuid, date) to authenticated;
grant execute on function public.cast_vote(uuid, text) to authenticated;
grant execute on function public.admin_set_vote(uuid, uuid, text) to authenticated;
grant execute on function public.complete_session(uuid, int, numeric) to authenticated;
grant execute on function public.record_membership_payment(uuid, numeric, date, date, date, text) to authenticated;
grant execute on function public.player_balances(uuid) to authenticated;
grant execute on function public.my_balance() to authenticated;
grant execute on function public.pool_summary(uuid, date, date) to authenticated;
grant execute on function public.public_today_summary(text) to anon, authenticated;

-- ---------------------------------------------------------------- realtime

alter publication supabase_realtime add table public.attendance_votes;
alter publication supabase_realtime add table public.sessions;
