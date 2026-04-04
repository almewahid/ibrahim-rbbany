// ============================================================
// generateLessonSummary.ts — نسخة Supabase
// ------------------------------------------------------------
// التغييرات من Base44:
//   1. base44.auth.me()                      → supabase.auth.getUser()
//   2. base44.integrations.Core.InvokeLLM    → fetch Anthropic API
//   3. base44.entities.BroadcastCover.filter → supabase.from()
//   4. base44.entities.BroadcastCover.update → supabase.update()
//
// النسختان .js و .ts كانتا متطابقتين — أنتجنا نسخة واحدة.
// ============================================================

import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  // ── 1. Auth ──
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

  // ── 2. Parse body ──
  const { broadcast_id, lesson_topic, lesson_content } = await req.json();

  if (!lesson_topic) {
    return Response.json({ error: "lesson_topic is required" }, { status: 400 });
  }

  // ── 3. Call Anthropic (replaces: base44.integrations.Core.InvokeLLM) ──
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) {
    return Response.json({ error: "AI API key not configured" }, { status: 500 });
  }

  // Prompt مطابق تماماً للأصل
  const prompt = `أنت خبير في تلخيص الدروس الشرعية. 
لخص هذا الدرس بطريقة واضحة ومختصرة:

الموضوع: ${lesson_topic}
${lesson_content ? `المحتوى: ${lesson_content}` : ""}

اكتب ملخصاً في 5-7 نقاط رئيسية.`;

  const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type":      "application/json",
      "x-api-key":         anthropicKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model:      "claude-haiku-4-5-20251001",
      max_tokens: 800,
      messages:   [{ role: "user", content: prompt }],
    }),
  });

  if (!aiRes.ok) {
    const err = await aiRes.text();
    console.error("Anthropic error:", err);
    return Response.json({ error: "AI generation failed", success: false }, { status: 502 });
  }

  const aiData  = await aiRes.json();
  const summary = aiData.content?.[0]?.text?.trim() ?? "";

  // ── 4. Save to broadcast_cover if broadcast_id provided ──
  // (replaces: base44.entities.BroadcastCover.filter + update)
  if (broadcast_id) {
    const { data: cover } = await supabase
      .from("broadcast_covers")
      .select("id")
      .eq("broadcast_id", broadcast_id)
      .maybeSingle();

    if (cover) {
      await supabase
        .from("broadcast_covers")
        .update({ previous_summary: summary })
        .eq("id", cover.id);
    }
  }

  return Response.json({ success: true, summary });
});
