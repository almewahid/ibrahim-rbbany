// ============================================================
// Edge Function: save-onesignal-token
// ------------------------------------------------------------
// Called from the frontend after the user grants notification
// permission. Registers their OneSignal Player ID (device token)
// as an External User ID so we can target them by user_id.
//
// This must be called once after login and once after the user
// grants push notification permission.
//
// Request body:
// {
//   onesignal_player_id: string   (OneSignal device/player ID)
// }
//
// Frontend usage (React / React Native):
//   import OneSignal from 'react-onesignal';   // or react-native-onesignal
//
//   const playerId = await OneSignal.getPlayerId();
//   await supabase.functions.invoke('save-onesignal-token', {
//     body: { onesignal_player_id: playerId }
//   });
//
// Environment variables:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   SUPABASE_ANON_KEY
//   ONESIGNAL_APP_ID
//   ONESIGNAL_API_KEY
// ============================================================

import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Get the calling user from their JWT
  const supabaseUser = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: authErr } = await supabaseUser.auth.getUser();
  if (authErr || !user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { onesignal_player_id } = await req.json();

  if (!onesignal_player_id) {
    return new Response(
      JSON.stringify({ error: "onesignal_player_id is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const appId  = Deno.env.get("ONESIGNAL_APP_ID")!;
  const apiKey = Deno.env.get("ONESIGNAL_API_KEY")!;

  // Tell OneSignal: this device belongs to this user
  // OneSignal will route push notifications to this device
  // when we call send-push-notification with the user's UUID.
  const response = await fetch(
    `https://onesignal.com/api/v1/players/${onesignal_player_id}`,
    {
      method: "PUT",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Basic ${apiKey}`,
      },
      body: JSON.stringify({
        app_id:               appId,
        external_user_id:     user.id,   // Supabase user UUID
        external_user_id_auth_hash: "",  // Optional: add HMAC for extra security
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    console.error("OneSignal player update failed:", err);
    return new Response(
      JSON.stringify({ error: "Failed to register device" }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({ success: true }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
