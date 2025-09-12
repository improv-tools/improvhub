-- ============================================================
-- producers.sql
-- Run order: 1) utils.sql  2) acts.sql  3) producers.sql  4) user.sql  5) calendar.sql
-- WHY: Define PRODUCER entity and membership so owners/user.sql can sync it into owner_users.
-- ============================================================

create table if not exists producers (
  id uuid primary key default gen_random_uuid(),
  name text not null
);

create table if not exists producer_users (
  producer_id uuid not null references producers(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role entity_user_role not null default 'viewer',
  primary key (producer_id, user_id)
);

-- Optional RLS (enable if you want to restrict direct selects to operators)
-- alter table producers enable row level security;
-- alter table producer_users enable row level security;
-- create policy producer_users_self on producer_users for select using (user_id = auth.uid());
