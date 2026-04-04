// ============================================================
// Edge Function: listener-stats-snapshot
// ------------------------------------------------------------
// Cron job — runs every 60 seconds during live broadcasts.
// Takes a snapshot of active listeners per broadcast and
// inserts a row into listener_stats.
//
// How to schedule (Supabase Cron — pg_cron):
//   Run this SQL in your Supabase SQL Editor:
//
//   select cron.schedule(
//     'listener-stats-snapshot',
//     '* * * * *',   -- every minute
//     $$
//     select net.http_post(
//       url    := 'https://<project-ref>.supabase.co/functions/v1/listener-stats-snapshot',
//       headers := '{"Content-Type":"application/json","Authorization":"Bearer <SERVICE_ROLE_KEY>"}'::jsonb,
//       body   := '{}'::jsonb
//     )
//     $$
//   );
//
// To unschedule:
//   select cron.unschedule('listener-stats-snapshot');
//
// Environment variables:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
// ============================================================

import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  // Accept POST from pg_cron or manual call
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const now = new Date().toISOString();

  // 1. Get all currently live broadcasts
  const { data: liveBroadcasts, error: liveErr } = await supabase
    .from("broadcasts")
    .select("id, total_listeners")
    .eq("is_live", true);

  if (liveErr) {
    console.error("Failed to fetch live broadcasts:", liveErr);
    return new Response("Error", { status: 500 });
  }

  if (!liveBroadcasts || liveBroadcasts.length === 0) {
    return new Response(
      JSON.stringify({ success: true, snapshots: 0 }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  // 2. For each live broadcast, count active listeners and insert snapshot
  const snapshots = await Promise.allSettled(
    liveBroadcasts.map(async (broadcast) => {
      // Count active listeners right now
      const { count: activeCount } = await supabase
        .from("listeners")
        .select("*", { count: "exact", head: true })
        .eq("broadcast_id", broadcast.id)
        .eq("is_active", true);

      // Count total joins ever
      const { count: totalJoins } = await supabase
        .from("listeners")
        .select("*", { count: "exact", head: true })
        .eq("broadcast_id", broadcast.id);

      const active = activeCount ?? 0;
      const total  = totalJoins  ?? 0;

      // Insert snapshot row
      await supabase.from("listener_stats").insert({
        broadcast_id:             broadcast.id,
        timestamp:                now,
        active_listeners:         active,
        peak_listeners:           broadcast.total_listeners ?? active,
        total_joins:              total,
        total_leaves:             total - active,
        average_duration_minutes: 0, // calculated at broadcast end
      });

      // Also keep broadcasts.listener_count in sync
      // (DB trigger does this too, but Cron ensures consistency)
      await supabase
        .from("broadcasts")
        .update({ listener_count: active })
        .eq("id", broadcast.id);

      return { broadcast_id: broadcast.id, active_listeners: active };
    })
  );

  const succeeded = snapshots.filter((r) => r.status === "fulfilled").length;
  const failed    = snapshots.filter((r) => r.status === "rejected").length;

  return new Response(
    JSON.stringify({
      success:   true,
      snapshots: succeeded,
      failed,
      timestamp: now,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
