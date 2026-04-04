// ============================================================
// Edge Function: generate-agora-token
// ------------------------------------------------------------
// نسخة Supabase — مطابقة للمنطق الأصلي في Base44
// الفرق الوحيد: استبدال base44.auth.me() بـ Supabase JWT
//
// Environment variables:
//   AGORA_APP_ID
//   AGORA_APP_CERTIFICATE
//   SUPABASE_URL
//   SUPABASE_ANON_KEY
//
// Request body:
// {
//   channelName: string        (= broadcast.id عادةً)
//   role: 'broadcaster' | 'audience'
//   uid?: number               (اختياري — يُحسب تلقائياً)
// }
//
// Response:
// {
//   token: string
//   uid: number
//   appId: string
//   channelName: string
//   expiresAt: number          (Unix timestamp)
// }
// ============================================================

import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// Agora token builder — same package as Base44
import {
  RtcTokenBuilder,
  RtcRole,
} from "npm:agora-access-token@2.0.4";

// ── Simple hash: UUID string → 32-bit int (same logic as Base44) ──
function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash;
}

serve(async (req) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  // ── 1. Authenticate via Supabase JWT (replaces base44.auth.me()) ──
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

  // ── 2. Parse request body ──
  const { channelName, role, uid } = await req.json();

  if (!channelName) {
    return Response.json({ error: "channelName is required" }, { status: 400 });
  }

  // ── 3. Agora credentials ──
  const appId          = Deno.env.get("AGORA_APP_ID");
  const appCertificate = Deno.env.get("AGORA_APP_CERTIFICATE");

  if (!appId || !appCertificate) {
    return Response.json(
      { error: "Agora credentials not configured" },
      { status: 500 }
    );
  }

  // ── 4. Build token (identical logic to Base44 .ts version) ──
  const expirationTimeInSeconds = 3600 * 24; // 24 hours
  const currentTimestamp  = Math.floor(Date.now() / 1000);
  const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;

  // broadcaster → PUBLISHER (can send audio/video)
  // audience   → SUBSCRIBER (listen only)
  const userRole = role === "broadcaster"
    ? RtcRole.PUBLISHER
    : RtcRole.SUBSCRIBER;

  // UID strategy (matches Base44 .ts version):
  //   - If uid provided → use it
  //   - Audience         → random int (avoids collision)
  //   - Broadcaster      → deterministic hash of Supabase user.id
  const userUid: number = uid
    ? uid
    : role === "audience"
      ? Math.floor(Math.random() * 2_000_000_000) + 1
      : Math.abs(hashCode(user.id));

  const token = RtcTokenBuilder.buildTokenWithUid(
    appId,
    appCertificate,
    channelName,
    userUid,
    userRole,
    privilegeExpiredTs
  );

  // ── 5. Optional: log join in listeners table ──
  // (Only for audience joining a live broadcast)
  if (role === "audience") {
    // channelName is the broadcast UUID
    await supabase.from("listeners").upsert(
      {
        broadcast_id: channelName,
        user_id:      user.id,
        user_name:    user.user_metadata?.full_name ?? user.email ?? "مستمع",
        joined_at:    new Date().toISOString(),
        is_active:    true,
      },
      { onConflict: "broadcast_id,user_id" }
    );
  }

  return Response.json({
    token,
    uid:         userUid,
    appId,
    channelName,
    expiresAt:   privilegeExpiredTs,
  });
});
