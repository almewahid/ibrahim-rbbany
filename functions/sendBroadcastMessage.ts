// ============================================================
// sendBroadcastMessage.ts — نسخة Supabase
// ------------------------------------------------------------
// التغييرات من Base44:
//   1. base44.auth.me() + role         → supabase.auth.getUser() + profiles
//   2. base44.asServiceRole.entities.User.list() → supabase admin profiles
//   3. loop of Notification.create     → bulk insert + OneSignal push
// ============================================================

import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  // ── 1. Auth: admin only ──
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role !== "admin") {
    return Response.json({ error: "Unauthorized - Admin only" }, { status: 401 });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // ── 2. Parse body ──
  const { title, message, type = "broadcast_message" } = await req.json();
  if (!title || !message) {
    return Response.json({ error: "Title and message are required" }, { status: 400 });
  }

  // ── 3. Get all users except sender (replaces: base44.asServiceRole.entities.User.list) ──
  const { data: allUsers, error: usersErr } = await admin
    .from("profiles")
    .select("id")
    .neq("id", user.id);   // Don't send to self — same logic as Base44

  if (usersErr || !allUsers || allUsers.length === 0) {
    return Response.json({ success: true, sent_count: 0 });
  }

  // ── 4. Bulk insert notifications (replaces: loop of Notification.create) ──
  const notifications = allUsers.map((u) => ({
    user_id: u.id,
    type,
    title,
    message,
    is_read: false,
  }));

  const { error: notifErr } = await admin
    .from("notifications")
    .insert(notifications);

  if (notifErr) {
    console.error("Failed to insert notifications:", notifErr);
    return Response.json({ error: "Failed to send notifications", success: false }, { status: 500 });
  }

  // ── 5. OneSignal push to all users ──
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
        app_id:            appId,
        included_segments: ["All"],   // جميع المستخدمين
        headings: { ar: title,   en: title   },
        contents: { ar: message, en: message },
        data: { type },
      }),
    });
  }

  return Response.json({
    success:    true,
    message:    `تم إرسال ${allUsers.length} إشعار`,
    sent_count: allUsers.length,
  });
});
