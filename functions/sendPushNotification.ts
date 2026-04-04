// ============================================================
// Edge Function: send-push-notification
// ------------------------------------------------------------
// Generic push notification sender via OneSignal.
// Called internally by other Edge Functions — not called
// directly from the frontend.
//
// Environment variables required (set in Supabase Dashboard
// → Project Settings → Edge Functions → Secrets):
//   ONESIGNAL_APP_ID       — your OneSignal App ID
//   ONESIGNAL_API_KEY      — your OneSignal REST API Key
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

interface PushPayload {
  // Send to specific user IDs (stored as External User IDs in OneSignal)
  user_ids?: string[];
  // OR send to a specific OneSignal segment
  segment?: string;
  title: string;
  message: string;
  // Optional deep-link data
  data?: Record<string, string>;
  // Optional URL to open on click (web)
  url?: string;
}

serve(async (req) => {
  // Only allow POST
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Validate caller is internal (service-role header)
  const authHeader = req.headers.get("Authorization") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!authHeader.includes(serviceRoleKey)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const payload: PushPayload = await req.json();

  const appId  = Deno.env.get("ONESIGNAL_APP_ID")  ?? "";
  const apiKey = Deno.env.get("ONESIGNAL_API_KEY") ?? "";

  if (!appId || !apiKey) {
    return new Response(
      JSON.stringify({ error: "OneSignal credentials not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  // Build OneSignal notification body
  // Docs: https://documentation.onesignal.com/reference/create-notification
  const body: Record<string, unknown> = {
    app_id: appId,
    headings: { ar: payload.title, en: payload.title },
    contents: { ar: payload.message, en: payload.message },
    ...(payload.data && { data: payload.data }),
    ...(payload.url  && { url: payload.url }),
  };

  if (payload.user_ids && payload.user_ids.length > 0) {
    // Target specific users by their External User ID
    body.include_external_user_ids = payload.user_ids;
    body.channel_for_external_user_ids = "push";
  } else if (payload.segment) {
    body.included_segments = [payload.segment];
  } else {
    return new Response(
      JSON.stringify({ error: "Must provide user_ids or segment" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const response = await fetch("https://onesignal.com/api/v1/notifications", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Basic ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const result = await response.json();

  if (!response.ok) {
    console.error("OneSignal error:", result);
    return new Response(
      JSON.stringify({ error: "OneSignal request failed", details: result }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({ success: true, onesignal_id: result.id }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
