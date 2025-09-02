-- Rename a team (admin only). Keeps display_id stable.
drop function if exists public.admin_rename_team(uuid, text);

create or replace function public.admin_rename_team(
  p_team_id uuid,
  p_name text
)
returns table(id uuid, name text, display_id text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(trim(p_name), '') = '' then
    raise exception 'team name required' using errcode = '22023';
  end if;

  -- caller must be admin
  if not exists (
    select 1 from public.team_members tm
    where tm.team_id = p_team_id
      and tm.user_id = auth.uid()
      and tm.role = 'admin'
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- QUALIFY the column to avoid ambiguity with OUT param "id"
  update public.teams as t
  set name = p_name, updated_at = now()
  where t.id = p_team_id;

  return query
    select t.id, t.name, t.display_id
    from public.teams t
    where t.id = p_team_id;
end;
$$;

revoke all on function public.admin_rename_team(uuid, text) from public;
grant execute on function public.admin_rename_team(uuid, text) to authenticated;


-- Delete a team (admin only). Cascades to team_members via FK.
drop function if exists public.admin_delete_team(uuid);

create or replace function public.admin_delete_team(
  p_team_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- authorize: caller must be an admin of this team
  if not exists (
    select 1 from public.team_members tm
    where tm.team_id = p_team_id
      and tm.user_id = auth.uid()
      and tm.role = 'admin'
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  delete from public.teams where id = p_team_id;
  -- team_members rows are removed automatically by ON DELETE CASCADE
end;
$$;

revoke all on function public.admin_delete_team(uuid) from public;
grant execute on function public.admin_delete_team(uuid) to authenticated;
