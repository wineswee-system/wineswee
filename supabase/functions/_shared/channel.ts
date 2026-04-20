// Shared LINE channel resolution for edge functions.
// Used by line-webhook, line-login, line-push (messaging/login channels).

export interface LineChannelRow {
  id: number;
  code: string;
  name: string;
  channel_id: string | null;
  liff_id: string | null;
  webhook_url: string | null;
  is_default: boolean;
  status: string;
}

export function envKey(prefix: string, code: string): string {
  return `${prefix}_${code.toUpperCase().replace(/-/g, "_")}`;
}

export function resolveEnv(prefix: string, code: string | null | undefined): string | null {
  if (code) {
    const v = Deno.env.get(envKey(prefix, code));
    if (v) return v;
  }
  return Deno.env.get(prefix) ?? null;
}

export interface ResolveOpts {
  queryCode?: string | null;       // from ?channel=XXX
  destinationId?: string | null;   // from LINE webhook payload `destination`
}

/**
 * Resolve a LINE channel row by:
 * 1. explicit `?channel=code` (by line_channels.code)
 * 2. LINE `destination` (bot userId → line_channels.channel_id)
 * 3. `is_default = true`
 * 4. first active row
 */
export async function resolveChannel(
  db: { from: (t: string) => any },
  opts: ResolveOpts,
): Promise<LineChannelRow | null> {
  if (opts.queryCode) {
    const { data } = await db
      .from("line_channels")
      .select("*")
      .eq("code", opts.queryCode)
      .maybeSingle();
    if (data) return data as LineChannelRow;
  }

  if (opts.destinationId) {
    const { data } = await db
      .from("line_channels")
      .select("*")
      .eq("channel_id", opts.destinationId)
      .maybeSingle();
    if (data) return data as LineChannelRow;
  }

  const { data: def } = await db
    .from("line_channels")
    .select("*")
    .eq("is_default", true)
    .eq("status", "active")
    .maybeSingle();
  if (def) return def as LineChannelRow;

  const { data: any } = await db
    .from("line_channels")
    .select("*")
    .eq("status", "active")
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (any as LineChannelRow) ?? null;
}
