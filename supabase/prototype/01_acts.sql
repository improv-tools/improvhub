-- ============================================================
-- acts.sql
-- Run order: 1) utils.sql  2) acts.sql  3) producers.sql  4) user.sql  5) calendar.sql
-- WHY: Define ACT entity and membership so owners/user.sql can sync it into owner_users.
-- ============================================================

create table if not exists acts (
  id uuid primary key default gen_random_uuid(),
  name text not null
);

create table if not exists act_users (
  act_id uuid not null references acts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role entity_user_role not null default 'viewer',
  primary key (act_id, user_id)
);

-- Optional RLS (enable if you want to restrict direct selects to operators)
-- alter table acts enable row level security;
-- alter table act_users enable row level security;
-- create policy act_users_self on act_users for select using (user_id = auth.uid());
