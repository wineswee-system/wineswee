// Shared LINE channel resolution for edge functions.
// Single-channel setup: resolveEnv always uses global env vars (no per-channel suffix).

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

export function resolveEnv(prefix: string): string | null {
  return Deno.env.get(prefix) ?? null;
}

export interface ResolveOpts {
  destinationId?: string | null; // from LINE webhook payload `destination`
}

/**
 * Resolve the active LINE channel row.
 * Tries destination match first, then default, then first active.
 */
export async function resolveChannel(
  db: { from: (t: string) => any },
  opts: ResolveOpts = {},
): Promise<LineChannelRow | null> {
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

  const { data: first } = await db
    .from("line_channels")
    .select("*")
    .eq("status", "active")
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (first as LineChannelRow) ?? null;
}
