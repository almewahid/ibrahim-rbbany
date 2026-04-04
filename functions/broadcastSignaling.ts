// ============================================================
// broadcastSignaling.ts — نسخة Supabase
// ------------------------------------------------------------
// ⚠️  المشكلة في النسخة الأصلية (Base44):
//     const connections = new Map()
//     Edge Functions stateless — كل طلب instance جديدة.
//     الـ Map تُمسح في كل استدعاء → لا يعمل أبداً في الإنتاج.
//
// ✅  الحل في Supabase:
//     نستبدل الـ Map بـ جدولين في قاعدة البيانات:
//       - broadcast_signals  (لتبادل WebRTC signals)
//       - listeners          (موجود من phase4 — لتتبع الحضور)
//     الـ Frontend يستخدم Supabase Realtime للاستماع للتغييرات.
//
// الـ actions المدعومة (نفس Base44):
//   start_broadcast | join_broadcast | send_signal |
//   get_signals | leave_broadcast | stop_broadcast
//
// Environment variables:
//   SUPABASE_URL
//   SUPABASE_ANON_KEY
//   SUPABASE_SERVICE_ROLE_KEY
// ============================================================

import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  // ── Auth ──
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

  // Admin client for operations that bypass RLS
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { action, broadcastId, signal, listenerId } = await req.json();

  switch (action) {

    // ── Broadcaster starts streaming ──
    case "start_broadcast": {
      await admin
        .from("broadcasts")
        .update({ is_live: true, started_at: new Date().toISOString() })
        .eq("id", broadcastId);

      // Clean up any stale signals from previous session
      await admin
        .from("broadcast_signals")
        .delete()
        .eq("broadcast_id", broadcastId);

      return Response.json({ success: true, broadcastId });
    }

    // ── Listener joins ──
    case "join_broadcast": {
      const { data: broadcast } = await supabase
        .from("broadcasts")
        .select("id, is_live")
        .eq("id", broadcastId)
        .single();

      if (!broadcast) {
        return Response.json({ error: "Broadcast not found" }, { status: 404 });
      }

      // Upsert into listeners table (from phase4)
      await admin.from("listeners").upsert(
        {
          broadcast_id: broadcastId,
          user_id:      user.id,
          user_name:    user.user_metadata?.full_name ?? "مستمع",
          joined_at:    new Date().toISOString(),
          is_active:    true,
        },
        { onConflict: "broadcast_id,user_id" }
      );

      // Count active listeners
      const { count } = await admin
        .from("listeners")
        .select("*", { count: "exact", head: true })
        .eq("broadcast_id", broadcastId)
        .eq("is_active", true);

      return Response.json({ success: true, listenerCount: count ?? 0 });
    }

    // ── WebRTC signal exchange ──
    // (المستخدم يرسل signal — يُخزَّن في DB ويُرسَل عبر Realtime)
    case "send_signal": {
      await admin.from("broadcast_signals").insert({
        broadcast_id: broadcastId,
        from_user_id: user.id,
        signal_data:  signal,
        created_at:   new Date().toISOString(),
      });

      return Response.json({ success: true });
    }

    // ── Get pending signals (polling fallback) ──
    case "get_signals": {
      const { data: signals } = await admin
        .from("broadcast_signals")
        .select("from_user_id, signal_data, created_at")
        .eq("broadcast_id", broadcastId)
        .neq("from_user_id", user.id)   // same filter as Base44: s.from !== user.id
        .order("created_at", { ascending: true });

      return Response.json({ signals: signals ?? [] });
    }

    // ── Listener leaves ──
    case "leave_broadcast": {
      await admin
        .from("listeners")
        .update({ is_active: false })
        .eq("broadcast_id", broadcastId)
        .eq("user_id", listenerId ?? user.id);

      return Response.json({ success: true });
    }

    // ── Broadcaster stops ──
    case "stop_broadcast": {
      await admin
        .from("broadcasts")
        .update({ is_live: false, ended_at: new Date().toISOString() })
        .eq("id", broadcastId);

      // Clean up signals
      await admin
        .from("broadcast_signals")
        .delete()
        .eq("broadcast_id", broadcastId);

      return Response.json({ success: true });
    }

    default:
      return Response.json({ error: "Invalid action" }, { status: 400 });
  }
});

// ============================================================
// SQL لجدول broadcast_signals — شغّله في Supabase SQL Editor:
//
// CREATE TABLE IF NOT EXISTS public.broadcast_signals (
//   id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
//   broadcast_id UUID NOT NULL REFERENCES public.broadcasts(id) ON DELETE CASCADE,
//   from_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
//   signal_data  JSONB NOT NULL,
//   created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
// );
// CREATE INDEX ON public.broadcast_signals(broadcast_id, created_at DESC);
//
// ALTER TABLE public.broadcast_signals ENABLE ROW LEVEL SECURITY;
// CREATE POLICY "signals_select" ON public.broadcast_signals
//   FOR SELECT USING (TRUE);
// CREATE POLICY "signals_insert" ON public.broadcast_signals
//   FOR INSERT WITH CHECK (from_user_id = auth.uid());
//
// -- Supabase Realtime: فعّل الجدول في Dashboard → Database → Replication
// ============================================================
