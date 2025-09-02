-- 001_create_profiles.sql
-- Migration: create user profiles table and policies

-- 1. Table
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. updated_at trigger function
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- 3. trigger
drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row
execute procedure public.set_updated_at();

-- 4. Enable RLS
alter table public.profiles enable row level security;

-- 5. Policies
-- Use create or replace to avoid duplication

-- Select own row
do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'profiles select own' and tablename = 'profiles') then
    create policy "profiles select own"
      on public.profiles
      for select
      using (auth.uid() = id);
  end if;
end$$;

-- Insert own row
do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'profiles insert own' and tablename = 'profiles') then
    create policy "profiles insert own"
      on public.profiles
      for insert
      with check (auth.uid() = id);
  end if;
end$$;

-- Update own row
do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'profiles update own' and tablename = 'profiles') then
    create policy "profiles update own"
      on public.profiles
      for update
      using (auth.uid() = id)
      with check (auth.uid() = id);
  end if;
end$$;

-- (Optional) uncomment to allow public read of all profiles:
-- create policy "profiles public read"
--   on public.profiles
--   for select
--   using (true);
