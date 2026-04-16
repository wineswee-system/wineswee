import type { SupabaseClient } from './types.ts';

export async function upsertLineUser(lineUserId: string, displayName: string, db: SupabaseClient) {
  const now = new Date().toISOString();
  const { data: existing } = await db
    .from("line_users").select("id, line_user_id, display_name, is_verified, employee_id, pending_action")
    .eq("line_user_id", lineUserId).maybeSingle();

  if (existing) {
    const updates: Record<string, unknown> = { last_active: now };
    if (displayName && displayName !== "使用者" && existing.display_name !== displayName) updates.display_name = displayName;
    await db.from("line_users").update(updates).eq("id", existing.id);
    return { row: { ...existing, display_name: (updates.display_name as string) ?? existing.display_name }, isNew: false };
  }

  const { data: inserted } = await db
    .from("line_users").insert({ line_user_id: lineUserId, display_name: displayName, is_verified: false, is_active: true, last_active: now })
    .select("id, line_user_id, display_name, is_verified, employee_id, pending_action").single();

  return { row: inserted, isNew: true };
}

export async function upsertLineGroupMember(lineUserId: string, lineGroupId: string, db: SupabaseClient) {
  try {
    // Find group row ID
    const { data: grp } = await db.from("line_groups").select("id").eq("line_group_id", lineGroupId).maybeSingle();
    if (!grp) return;
    const { data: existing } = await db.from("line_group_members").select("line_group_id").eq("line_user_id", lineUserId).eq("line_group_id", grp.id).maybeSingle();
    if (existing) return;
    await db.from("line_group_members").insert({ line_group_id: grp.id, line_user_id: lineUserId });
  } catch (e) { console.error("upsertLineGroupMember error:", e); }
}

export async function upsertLineGroup(groupId: string, groupName: string, db: SupabaseClient) {
  const { data: existing } = await db.from("line_groups").select("id, group_name").eq("line_group_id", groupId).maybeSingle();
  if (existing) {
    if (groupName && groupName !== existing.group_name) await db.from("line_groups").update({ group_name: groupName, is_active: true }).eq("id", existing.id);
    return existing;
  }
  const { data: inserted } = await db.from("line_groups")
    .insert({ line_group_id: groupId, group_name: groupName || groupId, group_type: "general", is_active: true, joined_at: now() })
    .select("id").single();
  return inserted;
}

function now() { return new Date().toISOString(); }

export async function logMessage(db: SupabaseClient, opts: {
  lineUserId: string; displayName?: string; messageText: string; sourceType: string;
  direction: "incoming" | "outgoing" | "outgoing_failed"; groupId?: string | null; eventType?: string;
}) {
  try {
    await db.from("line_messages").insert({
      line_user_id: opts.lineUserId, display_name: opts.displayName ?? null,
      message_text: opts.messageText, source_type: opts.sourceType,
      direction: opts.direction, group_id: opts.groupId ?? null, event_type: opts.eventType ?? "message",
    });
  } catch (err) { console.error("[logMessage] failed:", err); }
}

export async function logCommand(db: SupabaseClient, opts: {
  lineUserId: string; displayName?: string; commandMatched: string; rawInput: string;
  sourceType: string; groupId?: string | null; success?: boolean; errorMessage?: string | null;
  createdEntityType?: string | null; createdEntityId?: number | null; metadata?: Record<string, unknown> | null; executionMs?: number;
}) {
  try {
    await db.from("line_command_logs").insert({
      line_user_id: opts.lineUserId, display_name: opts.displayName ?? null,
      command_matched: opts.commandMatched, raw_input: opts.rawInput,
      source_type: opts.sourceType, group_id: opts.groupId ?? null,
      success: opts.success ?? true, error_message: opts.errorMessage ?? null,
      created_entity_type: opts.createdEntityType ?? null, created_entity_id: opts.createdEntityId ?? null,
      metadata: opts.metadata ?? null, execution_ms: opts.executionMs ?? null,
    });
  } catch (err) { console.error("[logCommand] failed:", err); }
}

export async function logError(db: SupabaseClient, opts: {
  lineUserId?: string | null; sourceType?: string; groupId?: string | null;
  errorType: string; errorMessage: string; context?: Record<string, unknown> | null;
}) {
  try {
    await db.from("line_error_logs").insert({
      line_user_id: opts.lineUserId ?? null, error_type: opts.errorType,
      error_message: opts.errorMessage, context: opts.context ?? null,
    });
  } catch (err) { console.error("[logError] failed:", err); }
}
