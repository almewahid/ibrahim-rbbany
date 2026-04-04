// ============================================================
// notifyNewRecording.ts — نسخة Supabase
// ------------------------------------------------------------
// التغييرات من Base44:
//   1. base44.asServiceRole.entities.Follow.filter        → supabase admin
//   2. base44.asServiceRole.entities.Notification.create  → supabase admin (bulk)
//   3. أضفنا: OneSignal push notification
//
// يُستدعى من DB Webhook عند INSERT على جدول recordings.
// Webhook setup:
//   Table: recordings | Event: INSERT
//   URL: /functions/v1/notifyNewRecording
//   Headers: Authorization: Bearer <SERVICE_ROLE_KEY>
// ============================================================

import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Supabase Webhook payload: { type, table, record, old_record, schema }
  const payload = await req.json();
  const data    = payload.record ?? payload.data; // دعم الطريقتين

  if (!data?.broadcaster_id) {
    return Response.json({ skipped: true, reason: "no broadcaster_id" });
  }

  // ── 1. Fetch followers (replaces: base44.asServiceRole.entities.Follow.filter) ──
  const { data: followers, error: fErr } = await admin
    .from("follows")
    .select("follower_id")
    .eq("following_id", data.broadcaster_id)
    .eq("notify_on_broadcast", true);

  if (fErr || !followers || followers.length === 0) {
    return Response.json({ success: true, notifications_sent: 0 });
  }

  const followerIds = followers.map((f) => f.follower_id);

  // ── 2. Bulk insert notifications (replaces: loop of Notification.create) ──
  const title   = "درس جديد متاح! 🎙️";
  const message = `تمت إضافة درس جديد: ${data.title ?? "درس جديد"}`;

  const notifications = followerIds.map((userId) => ({
    user_id:        userId,
    type:           "new_broadcast",
    title,
    message,
    broadcaster_id: data.broadcaster_id,
    is_read:        false,
    link:           `/RecordingDetails?id=${data.id}`, // same path as Base44
  }));

  const { error: notifErr } = await admin
    .from("notifications")
    .insert(notifications);

  if (notifErr) {
    console.error("Failed to insert notifications:", notifErr);
  }

  // ── 3. OneSignal push (لم يكن في Base44 — تحسين إضافي) ──
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
        app_id:                        appId,
        include_external_user_ids:     followerIds,
        channel_for_external_user_ids: "push",
        headings: { ar: title,   en: title   },
        contents: { ar: message, en: message },
        data: {
          type:         "new_recording",
          recording_id: data.id,
        },
        url: `/RecordingDetails?id=${data.id}`,
      }),
    });
  }

  return Response.json({ success: true, notifications_sent: followerIds.length });
});
