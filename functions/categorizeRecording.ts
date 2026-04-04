// ============================================================
// categorizeRecording.ts — نسخة Supabase
// ------------------------------------------------------------
// التغييرات من Base44:
//   1. base44.auth.me()                        → supabase.auth.getUser()
//   2. base44.asServiceRole.entities.Recording → supabase admin
//   3. base44.asServiceRole.integrations.Core.InvokeLLM → Anthropic API
//   4. base44.asServiceRole.entities.Recording.update  → supabase admin update
//
// المنطق (قائمة الفئات + التحقق منها) مطابق تماماً.
// ============================================================

import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const VALID_CATEGORIES = [
  "علوم شرعية",
  "تفسير القرآن",
  "الحديث النبوي",
  "الفقه الإسلامي",
  "السيرة النبوية",
  "تربية وتزكية",
  "نقاش",
  "أخرى",
];

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

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // ── 2. Parse body ──
  const { recording_id } = await req.json();
  if (!recording_id) {
    return Response.json({ error: "recording_id is required" }, { status: 400 });
  }

  // ── 3. Fetch recording (replaces: base44.asServiceRole.entities.Recording.filter) ──
  const { data: recording, error: recErr } = await admin
    .from("recordings")
    .select("title, description, broadcaster_name")
    .eq("id", recording_id)
    .single();

  if (recErr || !recording) {
    return Response.json({ error: "Recording not found" }, { status: 404 });
  }

  // ── 4. Call Anthropic (replaces: base44.integrations.Core.InvokeLLM) ──
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) {
    return Response.json({ error: "AI API key not configured" }, { status: 500 });
  }

  // Prompt مطابق تماماً للأصل
  const prompt = `قم بتحليل المحتوى التالي وتصنيفه إلى إحدى الفئات التالية:
- علوم شرعية
- تفسير القرآن
- الحديث النبوي
- الفقه الإسلامي
- السيرة النبوية
- تربية وتزكية
- نقاش
- أخرى

معلومات التسجيل:
العنوان: ${recording.title}
الوصف: ${recording.description ?? "لا يوجد"}
المحاضر: ${recording.broadcaster_name}

أجب بالفئة فقط دون أي نص إضافي.`;

  const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type":      "application/json",
      "x-api-key":         anthropicKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model:      "claude-haiku-4-5-20251001",
      max_tokens: 50,
      messages:   [{ role: "user", content: prompt }],
    }),
  });

  if (!aiRes.ok) {
    console.error("Anthropic error:", await aiRes.text());
    return Response.json({ error: "AI generation failed", success: false }, { status: 502 });
  }

  const aiData          = await aiRes.json();
  const suggested       = aiData.content?.[0]?.text?.trim() ?? "";

  // ── 5. Validate category (identical to Base44) ──
  const category = VALID_CATEGORIES.includes(suggested) ? suggested : "أخرى";

  // ── 6. Update recording (replaces: base44.asServiceRole.entities.Recording.update) ──
  await admin
    .from("recordings")
    .update({ category })
    .eq("id", recording_id);

  return Response.json({
    success: true,
    category,
    message: `تم تصنيف التسجيل كـ: ${category}`,
  });
});
