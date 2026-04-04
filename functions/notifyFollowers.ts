// ============================================================
// notifyFollowers.ts — نسخة Supabase
// ------------------------------------------------------------
// التغييرات من Base44:
//   1. base44.asServiceRole.entities.Broadcast.filter → supabase admin client
//   2. base44.asServiceRole.entities.Follow.filter    → supabase admin client
//   3. base44.asServiceRole.entities.Notification.create → supabase insert
//   4. أضفنا: OneSignal push notification لكل متابع
//
// لا يحتاج auth header — يُستدعى من DB Webhook أو Edge Function أخرى
// بـ service role فقط.
//
// Request body:
// {
//   broadcast_id: string
//   type: 'live_starting' | 'new_recording' | 'scheduled_reminder'
// }
//
// Environment variables:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   ONESIGNAL_APP_ID
//   ONESIGNAL_API_KEY
// ============================================================

import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  // ── هذه الـ function تعمل بـ service role فقط (لا JWT مطلوب) ──
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { broadcast_id, type } = await req.json();

  if (!broadcast_id) {
    return Response.json({ error: "broadcast_id is required" }, { status: 400 });
  }

  // ── 1. Fetch broadcast (replaces: base44.asServiceRole.entities.Broadcast.filter) ──
  const { data: broadcast, error: bErr } = await supabase
    .from("broadcasts")
    .select("id, title, broadcaster_id, broadcaster_name")
    .eq("id", broadcast_id)
    .single();

  if (bErr || !broadcast) {
    return Response.json({ error: "Broadcast not found" }, { status: 404 });
  }

  // ── 2. Fetch followers (replaces: base44.asServiceRole.entities.Follow.filter) ──
  const { data: followers, error: fErr } = await supabase
    .from("follows")
    .select("follower_id")
    .eq("following_id", broadcast.broadcaster_id)
    .eq("notify_on_broadcast", true);

  if (fErr || !followers || followers.length === 0) {
    return Response.json({ success: true, notifications_sent: 0 });
  }

  // ── 3. Build notification content (identical logic to Base44) ──
  let title   = "";
  let message = "";
  let notifType: string;

  if (type === "live_starting") {
    title      = "بث مباشر الآن!";
    message    = `${broadcast.broadcaster_name} بدأ بثاً مباشراً: ${broadcast.title}`;
    notifType  = "new_broadcast";
  } else if (type === "new_recording") {
    title      = "تسجيل جديد!";
    message    = `تسجيل جديد متاح من ${broadcast.broadcaster_name}: ${broadcast.title}`;
    notifType  = "new_broadcast";
  } else if (type === "scheduled_reminder") {
    title      = "تذكير: بث قريباً!";
    message    = `البث "${broadcast.title}" سيبدأ خلال 30 دقيقة`;
    notifType  = "broadcast_starting";
  } else {
    return Response.json({ error: "Invalid type" }, { status: 400 });
  }

  const followerIds = followers.map((f) => f.follower_id);

  // ── 4. Insert in-app notifications (bulk) ──
  // (replaces: loop of base44.asServiceRole.entities.Notification.create)
  const notifications = followerIds.map((userId) => ({
    user_id:        userId,
    type:           notifType,
    title,
    message,
    broadcast_id:   broadcast.id,
    broadcaster_id: broadcast.broadcaster_id,
    is_read:        false,
    link:           `/ListenBroadcast?id=${broadcast.id}`,  // same path as Base44
  }));

  const { error: notifErr } = await supabase
    .from("notifications")
    .insert(notifications);

  if (notifErr) {
    console.error("Failed to insert notifications:", notifErr);
  }

  // ── 5. Send OneSignal push (لم يكن في Base44 — تحسين إضافي) ──
  const appId  = Deno.env.get("ONESIGNAL_APP_ID");
  const apiKey = Deno.env.get("ONESIGNAL_API_KEY");

  if (appId && apiKey) {
    await fetch("https://onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Basic ${apiKey}`,
      },
      body: JSON.stringify({
        app_id:                         appId,
        include_external_user_ids:      followerIds,
        channel_for_external_user_ids:  "push",
        headings: { ar: title,   en: title   },
        contents: { ar: message, en: message },
        data: {
          type:         notifType,
          broadcast_id: broadcast.id,
        },
        url: `/ListenBroadcast?id=${broadcast.id}`,
      }),
    });
  }

  return Response.json({
    success:            true,
    notifications_sent: followerIds.length,
  });
});
