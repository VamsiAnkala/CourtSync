-- Run once after 001_courtsync.sql. Change the name, slug, PIN and players first.
with g as (
  insert into public.groups (name, slug, venue, play_time)
  values ('My Badminton Group', 'my-group', 'Your venue', '7:00 PM')
  returning id
), s as (
  insert into public.group_secrets (group_id, admin_pin_hash)
  select id, extensions.crypt('CHANGE-ME-1234', extensions.gen_salt('bf')) from g
  returning group_id
)
insert into public.players (group_id, name, tier, status, membership_valid_until)
select g.id, v.name, v.tier, 'ACTIVE', v.valid_until
from g, (values
  ('Player One',   'MEMBER',  (current_date + 30)),
  ('Player Two',   'MEMBER',  (current_date + 30)),
  ('Player Three', 'DROP_IN', null::date)
) as v(name, tier, valid_until);
