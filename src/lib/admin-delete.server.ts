// Server-only helpers for admin delete actions (owner / manager only).

export async function assertManagerLevel(supabase: any, userId: string) {
  const [{ data: isOwner }, { data: isManager }] = await Promise.all([
    supabase.rpc("has_role", { _user_id: userId, _role: "owner" }),
    supabase.rpc("has_role", { _user_id: userId, _role: "manager" }),
  ]);
  if (!isOwner && !isManager) throw new Error("无权限：仅总负责人 / 主管可删除");
}

export async function operatorName(admin: any, userId: string): Promise<string> {
  const { data } = await admin
    .from("profiles")
    .select("full_name, email")
    .eq("id", userId)
    .maybeSingle();
  return (data as any)?.full_name || (data as any)?.email || "系统";
}

export async function logDelete(
  admin: any,
  opts: { entity_type: string; entity_id: string; before: any; operator_id: string; operator_name: string; note: string },
) {
  await admin.from("admin_action_logs").insert({
    entity_type: opts.entity_type,
    entity_id: opts.entity_id,
    action: "delete",
    before: opts.before ?? null,
    after: null,
    operator_id: opts.operator_id,
    operator_name: opts.operator_name,
    note: opts.note,
  });
}
