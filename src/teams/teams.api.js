import { supabase } from "lib/supabaseClient";

/** List the teams the current user belongs to (with their role) */
export async function listMyTeams(userId) {
  const { data, error } = await supabase
    .from("team_members")
    .select("role, teams:team_id ( id, name, display_id )")
    .eq("user_id", userId);
  if (error) throw error;
  return (data || []).map(r => ({
    id: r.teams?.id,
    name: r.teams?.name,
    display_id: r.teams?.display_id,
    role: r.role,
  })).filter(t => t.id);
}

/** Try to generate a unique display_id like "Name#N" and create the team; creator becomes admin */
export async function createTeamWithAdmin(name, userId) {
  // try up to 5 times in case of race on unique display_id
  for (let attempt = 0; attempt < 5; attempt++) {
    // count existing of same name to propose next suffix
    const { count } = await supabase
      .from("teams")
      .select("*", { count: "exact", head: true })
      .eq("name", name);
    const display_id = `${name}#${(count || 0) + 1}`;

    // insert team
    const { data: team, error: tErr } = await supabase
      .from("teams")
      .insert({ name, display_id, created_by: userId })
      .select("id, name, display_id")
      .single();

    // on unique violation, retry with next suffix
    if (tErr) {
      const msg = (tErr.message || "").toLowerCase();
      if (msg.includes("duplicate") || tErr.code === "23505") continue;
      throw tErr;
    }

    // insert creator as admin
    const { error: mErr } = await supabase
      .from("team_members")
      .insert({ team_id: team.id, user_id: userId, role: "admin" });
    if (mErr) throw mErr;

    return team;
  }
  throw new Error("Could not allocate a unique team id. Please try again.");
}

/** Load team members (visible to team members by RLS) */
export async function listTeamMembers(teamId) {
  const { data, error } = await supabase
    .from("team_members")
    .select("user_id, role")
    .eq("team_id", teamId);
  if (error) throw error;
  return data || [];
}

/** Set member role (admin only by RLS) */
export async function setMemberRole(teamId, userId, role) {
  const { error } = await supabase
    .from("team_members")
    .update({ role })
    .eq("team_id", teamId)
    .eq("user_id", userId);
  if (error) throw error;
}
