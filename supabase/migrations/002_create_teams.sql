-- Enable if needed
create extension if not exists pgcrypto;

-- ========== TABLES ==========
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  display_id text not null unique,             -- e.g. "Acme#3"
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.team_members (
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','member')) default 'admin',
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

-- updated_at trigger for teams
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

drop trigger if exists set_teams_updated_at on public.teams;
create trigger set_teams_updated_at
before update on public.teams
for each row execute procedure public.set_updated_at();

-- Helper: is current user an admin of the given team?
create or replace function public.is_team_admin(team uuid)
returns boolean language sql stable as $$
  select exists (
    select 1
    from public.team_members tm
    where tm.team_id = team and tm.user_id = auth.uid() and tm.role = 'admin'
  );
$$;

-- ========== RLS ==========
alter table public.teams enable row level security;
alter table public.team_members enable row level security;

-- ----- TEAMS policies -----
drop policy if exists "teams select if member" on public.teams;
create policy "teams select if member"
on public.teams
for select
using (
  exists (
    select 1 from public.team_members tm
    where tm.team_id = teams.id and tm.user_id = auth.uid()
  )
);

drop policy if exists "teams insert by user" on public.teams;
create policy "teams insert by user"
on public.teams
for insert
with check (created_by = auth.uid());

-- (Optional later) add update/delete policies for admins if you want renames/deletes.

-- ----- TEAM_MEMBERS policies -----
drop policy if exists "team_members select if member" on public.team_members;
create policy "team_members select if member"
on public.team_members
for select
using (
  exists (
    select 1 from public.team_members me
    where me.team_id = team_members.team_id and me.user_id = auth.uid()
  )
);

-- Allow the team creator to add themselves as first member (admin)
drop policy if exists "team_members insert creator self" on public.team_members;
create policy "team_members insert creator self"
on public.team_members
for insert
with check (
  auth.uid() = user_id
  and exists (
    select 1 from public.teams t
    where t.id = team_members.team_id and t.created_by = auth.uid()
  )
);

-- Admins can add anyone (and choose role)
drop policy if exists "team_members insert by admin" on public.team_members;
create policy "team_members insert by admin"
on public.team_members
for insert
with check (public.is_team_admin(team_members.team_id));

-- Admins can change roles
drop policy if exists "team_members update by admin" on public.team_members;
create policy "team_members update by admin"
on public.team_members
for update
using (public.is_team_admin(team_members.team_id))
with check (public.is_team_admin(team_members.team_id));

-- Admins can remove anyone; users can remove themselves (leave)
drop policy if exists "team_members delete by admin_or_self" on public.team_members;
create policy "team_members delete by admin_or_self"
on public.team_members
for delete
using (public.is_team_admin(team_members.team_id) or auth.uid() = user_id);
