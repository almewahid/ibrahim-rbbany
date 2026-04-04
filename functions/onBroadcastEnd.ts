// ============================================================
// Edge Function: on-broadcast-end
// ------------------------------------------------------------
// Triggered by a Supabase Database Webhook when:
//   Table: broadcasts
//   Event: UPDATE
//   Filter: is_live = false  (was true before)
//
// Webhook setup (same as on-broadcast-live):
//   Table:  broadcasts | Events: UPDATE
//   URL:    https://<project-ref>.supabase.co/functions/v1/on-broadcast-end
//   Headers: Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
//
// What it does:
//   1. Records ended_at and duration on the broadcast
//   2. Takes a final listener_stats snapshot
//   3. Updates peak_listeners on the recording (if exists)
//   4. Sends "broadcast ended" in-app notification to active listeners
// ============================================================

import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  const payload   = await req.json();
  const newRecord = payload.record;
  const oldRecord = payload.old_record;

  // Only act when is_live flips TRUE → FALSE
  if (newRecord?.is_live !== false || oldRecord?.is_live !== true) {
    return new Response("No action needed", { status: 200 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const broadcastId     = newRecord.id;
  const broadcasterId   = newRecord.broadcaster_id;
  const broadcasterName = newRecord.broadcaster_name;
  const broadcastTitle  = newRecord.title;
  const startedAt       = newRecord.started_at
    ? new Date(newRecord.started_at)
    : null;
  const endedAt         = new Date();

  // 1. Update broadcast: set ended_at and duration_minutes
  const durationMinutes = startedAt
    ? Math.round((endedAt.getTime() - startedAt.getTime()) / 60000)
    : 0;

  await supabase
    .from("broadcasts")
    .update({
      ended_at:         endedAt.toISOString(),
      duration_minutes: durationMinutes,
    })
    .eq("id", broadcastId);

  // 2. Get final listener stats
  const { data: listenerData } = await supabase
    .from("listeners")
    .select("user_id, joined_at")
    .eq("broadcast_id", broadcastId);

  const totalJoins   = listenerData?.length ?? 0;
  const peakSnapshot = newRecord.total_listeners ?? totalJoins;

  // Calculate average listening duration
  let avgDurationMinutes = 0;
  if (listenerData && listenerData.length > 0 && startedAt) {
    const durations = listenerData.map((l) => {
      const joinedAt = l.joined_at ? new Date(l.joined_at) : startedAt;
      return (endedAt.getTime() - joinedAt.getTime()) / 60000;
    });
    avgDurationMinutes =
      durations.reduce((a, b) => a + b, 0) / durations.length;
  }

  // 3. Insert final listener_stats snapshot
  await supabase.from("listener_stats").insert({
    broadcast_id:             broadcastId,
    timestamp:                endedAt.toISOString(),
    active_listeners:         0,
    peak_listeners:           peakSnapshot,
    total_joins:              totalJoins,
    total_leaves:             totalJoins, // everyone left at end
    average_duration_minutes: Math.round(avgDurationMinutes * 100) / 100,
  });

  // 4. Update peak_listeners on the linked recording (if any)
  const { data: recording } = await supabase
    .from("recordings")
    .select("id")
    .eq("broadcast_id", broadcastId)
    .maybeSingle();

  if (recording) {
    await supabase
      .from("recordings")
      .update({ peak_listeners: peakSnapshot })
      .eq("id", recording.id);
  }

  // 5. Notify active listeners that broadcast has ended
  const { data: activeListeners } = await supabase
    .from("listeners")
    .select("user_id")
    .eq("broadcast_id", broadcastId)
    .eq("is_active", true);

  if (activeListeners && activeListeners.length > 0) {
    const notifications = activeListeners.map((l) => ({
      user_id:        l.user_id,
      type:           "broadcast_ended",
      title:          "انتهى البث المباشر",
      message:        `انتهى بث ${broadcasterName}: ${broadcastTitle}`,
      broadcast_id:   broadcastId,
      broadcaster_id: broadcasterId,
      is_read:        false,
      link:           `/broadcast/${broadcastId}`,
    }));

    await supabase.from("notifications").insert(notifications);
  }

  // DB trigger (phase7) already sets listeners.is_active = false
  // when is_live flips to false — no need to do it here.

  return new Response(
    JSON.stringify({
      success:          true,
      duration_minutes: durationMinutes,
      total_listeners:  totalJoins,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
