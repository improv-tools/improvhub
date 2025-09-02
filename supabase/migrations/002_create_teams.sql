-- Enable uuid/gen if not already
create extension if not exists pgcrypto;

-- Teams
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  display_id text not null unique,   -- e.g. "Acme Team#3"
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Memberships
create table if not exists public.team_members (
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','member')) default 'admin',
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

-- Keep updated_at fresh on teams
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

-- Helper: check if current user is admin of a team
create or replace function public.is_team_admin(team uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from public.team_members tm
    where tm.team_id = team and tm.user_id = auth.uid() and tm.role = 'admin'
  );
$$;

-- RLS
alter table public.teams enable row level security;
alter table public.team_members enable row level security;

-- Teams: members can select teams they belong to
create policy if not exists "teams select if member"
on public.teams for select
using (
  exists (
    select 1 from public.team_members tm
    where tm.team_id = teams.id and tm.user_id = auth.uid()
  )
);

-- Teams: any user can insert a team they create
create policy if not exists "teams insert by user"
on public.teams for insert
with check (created_by = auth.uid());

-- Team members: members can see membership of teams they belong to
create policy if not exists "team_members select if member"
on public.team_members for select
using (
  exists (
    select 1 from public.team_members me
    where me.team_id = team_members.team_id and me.user_id = auth.uid()
  )
);

-- Team members: allow user to add themselves (used right after creating a team)
create policy if not exists "team_members insert self"
on public.team_members for insert
with check (auth.uid() = user_id);

-- Team members: admins can add anyone to their team (and set role)
create policy if not exists "team_members insert by admin"
on public.team_members for insert
with check (public.is_team_admin(team_members.team_id));

-- Team members: admins can update roles
create policy if not exists "team_members update by admin"
on public.team_members for update
using (public.is_team_admin(team_members.team_id))
with check (public.is_team_admin(team_members.team_id));

-- Team members: admin or the user can delete membership (leave or remove)
create policy if not exists "team_members delete by admin_or_self"
on public.team_members for delete
using (public.is_team_admin(team_members.team_id) or auth.uid() = user_id);
