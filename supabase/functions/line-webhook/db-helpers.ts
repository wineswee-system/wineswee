import type { SupabaseClient } from './types.ts';

// ── DB helpers ───────────────────────────────────────────────────────────────

export async function upsertLineUser(
  lineUserId: string,
  displayName: string,
  db: SupabaseClient,
  channelId: number,
) {
  const now = new Date().toISOString();
  const { data: existing } = await db
    .from("line_users")
    .select("id, line_user_id, display_name, is_verified, employee_id, pending_action, channel_id")
    .eq("channel_id", channelId)
    .eq("line_user_id", lineUserId)
    .maybeSingle();

  if (existing) {
    const updates: Record<string, unknown> = { updated_at: now };
    if (displayName && displayName !== "使用者" && existing.display_name !== displayName) {
      updates.display_name = displayName;
    }
    if (existing.channel_id == null) {
      updates.channel_id = channelId;
    }
    await db.from("line_users").update(updates).eq("id", existing.id);
    return {
      row: {
        ...existing,
        display_name: (updates.display_name as string) ?? existing.display_name,
        channel_id: channelId,
      },
      isNew: false,
    };
  }

  const { data: inserted } = await db
    .from("line_users")
    .insert({ line_user_id: lineUserId, display_name: displayName, is_verified: false, channel_id: channelId })
    .select("id, line_user_id, display_name, is_verified, employee_id, pending_action, channel_id")
    .single();

  return { row: inserted, isNew: true };
}

/** Record that a LINE user was observed participating in a group. No-op on duplicate. */
export async function upsertLineGroupMember(lineUserId: string, lineGroupId: string, db: SupabaseClient) {
  try {
    const { data: existing } = await db
      .from("line_group_members")
      .select("id")
      .eq("line_user_id", lineUserId)
      .eq("group_id", lineGroupId)
      .maybeSingle();
    if (existing) return;
    await db.from("line_group_members").insert({
      line_user_id: lineUserId,
      group_id: lineGroupId,
      joined_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("upsertLineGroupMember error:", e);
  }
}

export async function upsertLineGroup(
  groupId: string,
  groupName: string,
  db: SupabaseClient,
  channelId: number,
) {
  const { data: existing } = await db
    .from("line_groups")
    .select("id, group_name, channel_id")
    .eq("channel_id", channelId)
    .eq("line_group_id", groupId)
    .maybeSingle();

  if (existing) {
    const updates: Record<string, unknown> = {};
    if (groupName && groupName !== existing.group_name) {
      updates.group_name = groupName;
      updates.is_active = true;
    }
    if (existing.channel_id == null) updates.channel_id = channelId;
    if (Object.keys(updates).length > 0) {
      await db.from("line_groups").update(updates).eq("id", existing.id);
    }
    return existing;
  }

  const { data: inserted } = await db
    .from("line_groups")
    .insert({
      line_group_id: groupId,
      group_name: groupName || groupId,
      group_type: "general",
      is_active: true,
      joined_at: new Date().toISOString(),
      channel_id: channelId,
    })
    .select("id")
    .single();

  return inserted;
}

// ── Logging helpers ──────────────────────────────────────────────────────────

export async function logMessage(
  db: SupabaseClient,
  opts: {
    channelId?: number | null;
    lineUserId: string;
    displayName?: string;
    messageText: string;
    sourceType: string;
    direction: "incoming" | "outgoing" | "outgoing_failed";
    groupId?: string | null;
    eventType?: string;
  }
): Promise<string | null> {
  try {
    const { data, error } = await db.from("line_messages").insert({
      channel_id: opts.channelId,
      line_user_id: opts.lineUserId,
      display_name: opts.displayName ?? null,
      message_text: opts.messageText,
      source_type: opts.sourceType,
      direction: opts.direction,
      group_id: opts.groupId ?? null,
      event_type: opts.eventType ?? "message",
    }).select("id").single();
    if (error) {
      console.error("[logMessage] insert error:", JSON.stringify(error));
      return null;
    }
    return data?.id ?? null;
  } catch (err) {
    console.error("[logMessage] insert failed:", err);
    return null;
  }
}

export async function logCommand(
  db: SupabaseClient,
  opts: {
    channelId?: number | null;
    lineUserId: string;
    displayName?: string;
    commandMatched: string;
    rawInput: string;
    sourceType: string;
    groupId?: string | null;
    success?: boolean;
    errorMessage?: string | null;
    createdEntityType?: string | null;
    createdEntityId?: string | null;
    metadata?: Record<string, unknown> | null;
    executionMs?: number;
  }
): Promise<void> {
  try {
    await db.from("line_command_logs").insert({
      channel_id: opts.channelId,
      line_user_id: opts.lineUserId,
      display_name: opts.displayName ?? null,
      command_matched: opts.commandMatched,
      raw_input: opts.rawInput,
      source_type: opts.sourceType,
      group_id: opts.groupId ?? null,
      success: opts.success ?? true,
      error_message: opts.errorMessage ?? null,
      execution_ms: opts.executionMs ?? null,
    });
  } catch (err) {
    console.error("[logCommand] insert failed:", err);
  }
}

export async function logError(
  db: SupabaseClient,
  opts: {
    channelId?: number | null;
    lineUserId?: string | null;
    sourceType?: string;
    groupId?: string | null;
    errorType: string;
    errorMessage: string;
    errorStack?: string | null;
    context?: Record<string, unknown> | null;
  }
): Promise<void> {
  try {
    await db.from("line_error_logs").insert({
      channel_id: opts.channelId ?? null,
      line_user_id: opts.lineUserId ?? null,
      source_type: opts.sourceType ?? "system",
      group_id: opts.groupId ?? null,
      error_type: opts.errorType,
      error_message: opts.errorMessage,
      error_stack: opts.errorStack ?? null,
      context: opts.context ?? null,
    });
  } catch (err) {
    console.error("[logError] insert failed (last resort):", err);
  }
}

/**
 * Resolve a LINE user ID to an employees.id (INT) via the multi-OA mapping
 * (employee_line_accounts) with line_users as fallback. Returns null if unlinked.
 */
export async function resolveLineUserToEmployeeId(
  db: SupabaseClient,
  lineUserId: string,
): Promise<number | null> {
  const { data: ela, error: elaErr } = await db
    .from("employee_line_accounts")
    .select("employee_id, is_verified, is_primary, channel_id")
    .eq("line_user_id", lineUserId)
    .eq("is_verified", true)
    .order("is_primary", { ascending: false })
    .limit(1)
    .maybeSingle();
  console.log(`[resolveLine] lineUserId=${lineUserId} ela=${JSON.stringify(ela)} err=${elaErr?.message ?? "null"}`);
  if (ela?.employee_id) return ela.employee_id as number;

  const { data: lu, error: luErr } = await db
    .from("line_users")
    .select("employee_id")
    .eq("line_user_id", lineUserId)
    .not("employee_id", "is", null)
    .limit(1)
    .maybeSingle();
  console.log(`[resolveLine] fallback lu=${JSON.stringify(lu)} err=${luErr?.message ?? "null"}`);
  return (lu?.employee_id as number | undefined) ?? null;
}
