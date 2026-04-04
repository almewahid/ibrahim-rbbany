// ============================================================
// Edge Function: on-broadcast-live
// ------------------------------------------------------------
// Triggered by a Supabase Database Webhook when:
//   Table: broadcasts
//   Event: UPDATE
//   Filter: is_live = true
//
// How to set up the webhook:
//   Supabase Dashboard → Database → Webhooks → Create Webhook
//   Table:  broadcasts
//   Events: UPDATE
//   URL:    https://<project-ref>.supabase.co/functions/v1/on-broadcast-live
//   Headers: Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
//
// What it does:
//   1. Fetches all followers of the broadcaster who want notifications
//   2. Inserts in-app notifications into public.notifications
//   3. Sends OneSignal push to all follower devices
//
// Environment variables:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   ONESIGNAL_APP_ID
//   ONESIGNAL_API_KEY
// ============================================================

import { serve }       from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  const payload = await req.json();

  // Supabase webhooks send { type, table, record, old_record, schema }
  const newRecord = payload.record;
  const oldRecord = payload.old_record;

  // Only act when is_live flips FALSE → TRUE
  if (!newRecord?.is_live || oldRecord?.is_live === true) {
    return new Response("No action needed", { status: 200 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const broadcastId    = newRecord.id;
  const broadcasterId  = newRecord.broadcaster_id;
  const broadcasterName = newRecord.broadcaster_name;
  const broadcastTitle  = newRecord.title;

  // 1. Get all followers who want notifications
  const { data: followers, error: followErr } = await supabase
    .from("follows")
    .select("follower_id")
    .eq("following_id", broadcasterId)
    .eq("notify_on_broadcast", true);

  if (followErr) {
    console.error("Failed to fetch followers:", followErr);
    return new Response("Error fetching followers", { status: 500 });
  }

  if (!followers || followers.length === 0) {
    return new Response("No followers to notify", { status: 200 });
  }

  const followerIds = followers.map((f) => f.follower_id);

  // 2. Insert in-app notifications (bulk insert)
  const notifications = followerIds.map((userId) => ({
    user_id:       userId,
    type:          "new_broadcast",
    title:         "بث مباشر جديد",
    message:       `${broadcasterName} بدأ بثاً مباشراً: ${broadcastTitle}`,
    broadcast_id:  broadcastId,
    broadcaster_id: broadcasterId,
    is_read:       false,
    link:          `/broadcast/${broadcastId}`,
  }));

  const { error: notifErr } = await supabase
    .from("notifications")
    .insert(notifications);

  if (notifErr) {
    console.error("Failed to insert notifications:", notifErr);
    // Continue anyway — push can still work
  }

  // 3. Send OneSignal push notification
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const pushRes = await fetch(
    `${supabaseUrl}/functions/v1/send-push-notification`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        user_ids: followerIds,
        title:    "📡 بث مباشر جديد",
        message:  `${broadcasterName}: ${broadcastTitle}`,
        data: {
          type:         "new_broadcast",
          broadcast_id: broadcastId,
        },
        url: `/broadcast/${broadcastId}`,
      }),
    }
  );

  if (!pushRes.ok) {
    const err = await pushRes.text();
    console.error("Push notification failed:", err);
  }

  return new Response(
    JSON.stringify({
      success:         true,
      notified_count:  followerIds.length,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
