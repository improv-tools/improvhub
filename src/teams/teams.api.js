import { supabase } from "lib/supabaseClient";

// List teams for current user from their membership rows (safe with RLS)
export async function listMyTeams(userId) {
  const { data, error } = await supabase
    .from("team_members")
    .select("role, teams:team_id ( id, name, display_id )")
    .eq("user_id", userId);
  if (error) throw error;
  return (data || [])
    .map(r => ({ id: r.teams?.id, name: r.teams?.name, display_id: r.teams?.display_id, role: r.role }))
    .filter(Boolean);
}

// Create team and make creator admin (as before)
export async function createTeamWithAdmin(name, userId) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { count } = await supabase
      .from("teams")
      .select("*", { count: "exact", head: true })
      .eq("name", name);
    const display_id = `${name}#${(count || 0) + 1}`;

    const { data: team, error: tErr } = await supabase
      .from("teams")
      .insert({ name, display_id, created_by: userId })
      .select("id, name, display_id")
      .single();

    if (tErr) {
      const msg = (tErr.message || "").toLowerCase();
      if (msg.includes("duplicate") || tErr.code === "23505") continue;
      throw tErr;
    }

    const { error: mErr } = await supabase
      .from("team_members")
      .insert({ team_id: team.id, user_id: userId, role: "admin" });
    if (mErr) throw mErr;

    return team;
  }
  throw new Error("Could not allocate a unique team id. Please try again.");
}

// === RPCs ===
export async function listTeamMembersRPC(teamId) {
  const { data, error } = await supabase.rpc("get_team_members", { p_team_id: teamId });
  if (error) throw error;
  return data || [];
}

export async function setMemberRoleRPC(teamId, userId, role) {
  const { error } = await supabase.rpc("admin_set_member_role", {
    p_team_id: teamId,
    p_user_id: userId,
    p_role: role,
  });
  if (error) throw error;
}
