-- === RPC: list members of a team (caller must be a member) ===
create or replace function public.get_team_members(p_team_id uuid)
returns table(
  user_id uuid,
  role text,
  email text,
  full_name text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- authorize: caller must be a member of the team
  if not exists (
    select 1 from public.team_members tm
    where tm.team_id = p_team_id and tm.user_id = auth.uid()
  ) then
    raise exception 'not a member of this team' using errcode = '42501';
  end if;

  return query
    select tm.user_id,
           tm.role,
           au.email,
           p.full_name
    from public.team_members tm
    left join public.profiles p on p.id = tm.user_id
    left join auth.users au on au.id = tm.user_id
    where tm.team_id = p_team_id
    order by (tm.role = 'admin') desc, au.email;
end;
$$;

revoke all on function public.get_team_members(uuid) from public;
grant execute on function public.get_team_members(uuid) to anon, authenticated;

-- === RPC: set a member's role (admin only) ===
create or replace function public.admin_set_member_role(
  p_team_id uuid,
  p_user_id uuid,
  p_role text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_role not in ('admin','member') then
    raise exception 'invalid role %', p_role using errcode = '22023';
  end if;

  -- authorize: caller must be an admin of the team
  if not exists (
    select 1 from public.team_members tm
    where tm.team_id = p_team_id
      and tm.user_id = auth.uid()
      and tm.role = 'admin'
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  update public.team_members
  set role = p_role
  where team_id = p_team_id and user_id = p_user_id;

  if not found then
    raise exception 'member not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.admin_set_member_role(uuid, uuid, text) from public;
grant execute on function public.admin_set_member_role(uuid, uuid, text) to authenticated;
