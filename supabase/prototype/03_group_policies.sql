-- 03_group_policies.sql
-- =============================================================================
-- PURPOSE
--   Define RLS policies for the group table that depend on helpers created in
--   04_user.sql (e.g., can_admin_group). Separated to avoid order/cyclic issues.
-- =============================================================================

alter table public."group" enable row level security;

do $$ begin
  -- Drop existing to avoid duplicates
  begin
    drop policy if exists group_update_admin_only on public."group";
  exception when undefined_object then null; end;
  -- Create admin-only update policy
  execute 'create policy group_update_admin_only on public."group" for update to authenticated ' ||
          'using (public.can_admin_group(group_id)) with check (public.can_admin_group(group_id))';
end $$;

